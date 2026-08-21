"""Closes the feedback loop.

Pulls the alerts analysts have reviewed from the Node backend, joins them to the
transactions they came from, and retrains on real labels rather than synthetic
ones.

One caveat worth understanding before you trust the output: this data is
*biased*. You only ever learn the outcome of transactions the system flagged, so
the model never sees the fraud it silently approved. Mitigating this properly
needs a small random sample of low-score transactions reviewed too. The script
reports how skewed the label set is so the problem stays visible.
"""

import sys
from collections import Counter
from pathlib import Path

import httpx
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402


def sign_in(client: httpx.Client) -> str:
    r = client.post(
        f"{settings.BACKEND_URL}/auth/login",
        json={"email": settings.BACKEND_EMAIL, "password": settings.BACKEND_PASSWORD},
    )
    r.raise_for_status()
    return r.json()["token"]


def fetch(client: httpx.Client, token: str) -> pd.DataFrame:
    headers = {"Authorization": f"Bearer {token}"}

    labels = client.get(f"{settings.BACKEND_URL}/alerts/labels", headers=headers)
    labels.raise_for_status()
    label_rows = labels.json()["labels"]
    if not label_rows:
        raise SystemExit("No reviewed alerts yet. Work the alert queue first.")

    label_map = {r["transactionId"]: r["label"] for r in label_rows}
    print(f"{len(label_map)} reviewed alerts found")

    rows, page = [], 1
    while True:
        resp = client.get(
            f"{settings.BACKEND_URL}/transactions",
            params={"page": page, "limit": 100},
            headers=headers,
        )
        resp.raise_for_status()
        payload = resp.json()
        rows.extend(payload["items"])
        if page >= payload["pages"]:
            break
        page += 1

    print(f"{len(rows)} transactions pulled from the ledger")

    records = []
    for tx in rows:
        if tx["transactionId"] not in label_map:
            continue
        records.append(
            {
                "amount": tx.get("amount", 0),
                "hour": pd.to_datetime(tx["timestamp"]).hour,
                "dayOfWeek": pd.to_datetime(tx["timestamp"]).dayofweek,
                "distanceKm": 0,
                "txCount24h": 0,
                "knownCategory": True,
                "categoryCount": 1,
                "cardTenureDays": 0,
                "entryMode": (tx.get("device") or {}).get("entryMode", "CHIP"),
                "merchantCategory": (tx.get("merchant") or {}).get("category"),
                "city": (tx.get("location") or {}).get("city"),
                "historyCount": 0,
                "is_fraud": label_map[tx["transactionId"]],
            }
        )

    return pd.DataFrame(records)


def main():
    with httpx.Client(timeout=30) as client:
        token = sign_in(client)
        df = fetch(client, token)

    if df.empty:
        raise SystemExit("No labelled transactions could be matched.")

    counts = Counter(df.is_fraud)
    print(f"\nLabelled set: {counts[1]} fraud, {counts[0]} legitimate")

    if min(counts.values()) < 20:
        print(
            "\nWARNING: one class has fewer than 20 examples. Training on this will\n"
            "produce a model that is confident and wrong. Review more alerts, or\n"
            "blend with the synthetic set using --data."
        )

    print(
        "\nSelection bias check: every row here was flagged by the current system.\n"
        "Fraud that scored low was never reviewed, so the model cannot learn from it.\n"
        "Add a random sample of approved transactions to the review queue to fix this."
    )

    out = Path("data/labelled_set.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    print(f"\nWrote {out}")
    print("Next: python training/train.py --data data/labelled_set.csv --version v2")


if __name__ == "__main__":
    main()
