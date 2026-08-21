"""Replays real ULB transactions through the ML service.

Useful for two things: proving the served model reproduces the offline numbers
(if it does not, something is wrong with the serving path), and generating
plausible traffic for a demo without inventing data.

  python tools/replay_ulb.py --n 500 --fraud-share 0.05
"""

import argparse
import sys
from pathlib import Path

import httpx
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

V_COLS = [f"V{i}" for i in range(1, 29)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/ulb/creditcard.csv")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--n", type=int, default=200)
    parser.add_argument("--fraud-share", type=float, default=0.05,
                        help="oversample fraud so a short replay shows both classes")
    parser.add_argument("--tail-frac", type=float, default=0.2,
                        help="sample from the last N of the file — the held-out period")
    args = parser.parse_args()

    path = Path(args.data)
    if not path.exists():
        raise SystemExit(f"{path} not found. Download creditcard.csv from Kaggle first.")

    df = pd.read_csv(path).sort_values("Time")
    tail = df.iloc[int(len(df) * (1 - args.tail_frac)):]

    n_fraud = min(int(args.n * args.fraud_share), int(tail.Class.sum()))
    sample = pd.concat([
        tail[tail.Class == 1].sample(n_fraud, random_state=1),
        tail[tail.Class == 0].sample(args.n - n_fraud, random_state=1),
    ]).sample(frac=1, random_state=1)

    print(f"Replaying {len(sample)} transactions ({n_fraud} known fraud) "
          f"from the held-out period\n")
    print(f"{'actual':>8}{'score':>8}{'amount':>12}   verdict")

    caught = missed = false_alarm = 0
    with httpx.Client(timeout=20) as client:
        for _, row in sample.iterrows():
            record = {"Time": float(row.Time), "Amount": float(row.Amount)}
            record.update({c: float(row[c]) for c in V_COLS})

            try:
                r = client.post(f"{args.url}/ulb/predict",
                                json={"record": record, "explain": False})
                r.raise_for_status()
                score = r.json()["score"]
            except Exception as exc:
                raise SystemExit(f"Request failed: {exc}")

            actual = int(row.Class)
            flagged = score >= 50
            if actual and flagged:
                caught += 1
                verdict = "CAUGHT"
            elif actual and not flagged:
                missed += 1
                verdict = "MISSED"
            elif flagged:
                false_alarm += 1
                verdict = "false alarm"
            else:
                verdict = "ok"

            if actual or flagged:
                print(f"{'FRAUD' if actual else 'legit':>8}{score:>8}"
                      f"{row.Amount:>12,.2f}   {verdict}")

    print(f"\ncaught {caught}   missed {missed}   false alarms {false_alarm}")
    print("\nA 50 cutoff is arbitrary — use the threshold from metadata_ulb_v1.json,")
    print("which was selected on the validation set, for anything you report.")


if __name__ == "__main__":
    main()
