"""Builds a labelled training set.

Preferred source is the real ledger: transactions the analysts have already
reviewed, pulled from the Node backend. Until enough of those exist, this falls
back to a synthetic generator with a realistic 0.4% fraud rate.

A synthetic set can only teach the model the patterns you deliberately put in
it. Treat it as scaffolding — swap to real labels as soon as the alert queue
has a few hundred reviewed cases.
"""

import argparse
import random
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

CITIES = {
    "Pune": (18.5204, 73.8567),
    "Mumbai": (19.0760, 72.8777),
    "Delhi": (28.6139, 77.2090),
    "Bengaluru": (12.9716, 77.5946),
    "Chennai": (13.0827, 80.2707),
    "Kolkata": (22.5726, 88.3639),
    "Hyderabad": (17.3850, 78.4867),
    "Jaipur": (26.9124, 75.7873),
}
CATEGORIES = ["GROCERY", "FUEL", "RESTAURANT", "ELECTRONICS", "TRAVEL", "JEWELLERY"]
EVERYDAY = ["GROCERY", "FUEL", "RESTAURANT"]


def haversine(a, b):
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(np.radians, [a[0], a[1], b[0], b[1]])
    h = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return float(2 * R * np.arcsin(np.sqrt(h)))


def _legit_gap(rng) -> float:
    """Hours since the previous authorisation on a legitimate card.

    Deliberately heavy at the short end: people buy coffee then lunch twenty
    minutes later. If legitimate gaps are always long, implied travel speed
    separates the classes perfectly and the model learns nothing else.
    """
    r = rng.random()
    if r < 0.18:
        return rng.uniform(0.05, 0.75)     # same outing
    if r < 0.55:
        return rng.uniform(0.75, 8.0)      # same day
    return rng.uniform(8.0, 200.0)         # days apart


def _fraud_gap(rng) -> float:
    """Fraud gaps overlap legitimate ones heavily. A stolen card used once,
    hours after the last real purchase, is the common case — not a burst."""
    r = rng.random()
    if r < 0.35:
        return rng.uniform(0.02, 0.75)
    if r < 0.70:
        return rng.uniform(0.75, 8.0)
    return rng.uniform(8.0, 200.0)


def synthesise(n: int = 60_000, fraud_rate: float = 0.004, seed: int = 42) -> pd.DataFrame:
    """Generate a labelled set where no single feature separates the classes.

    Fraud must be identifiable only from a *combination* of signals. Any feature
    whose fraud and legitimate ranges do not overlap is a leak, and will show up
    as one dominant importance in training with a suspiciously perfect PR AUC.
    """
    rng = random.Random(seed)
    np.random.seed(seed)
    rows = []
    n_fraud = int(n * fraud_rate)

    for i in range(n):
        is_fraud = i < n_fraud
        home = rng.choice(list(CITIES))
        tenure = rng.randint(30, 1500)
        history = rng.randint(5, 200)

        if is_fraud:
            archetype = rng.choice(["card_not_present", "testing", "travel_burst", "blended"])

            if archetype == "card_not_present":
                amount = rng.uniform(15_000, 200_000)
                hour = rng.choice([0, 1, 2, 3, 4, 5, 22, 23] + list(range(9, 21)))
                city = rng.choice([c for c in CITIES if c != home]) if rng.random() < 0.75 else home
                category = rng.choice(["ELECTRONICS", "JEWELLERY", "TRAVEL"] + EVERYDAY)
                entry = rng.choices(["MANUAL", "SWIPE", "CHIP"], [0.55, 0.3, 0.15])[0]
                tx24 = rng.randint(1, 6)
            elif archetype == "testing":
                amount = rng.uniform(20, 900)
                hour = rng.randint(0, 23)
                city = rng.choice(list(CITIES))
                category = rng.choice(CATEGORIES)
                entry = rng.choices(["MANUAL", "SWIPE"], [0.7, 0.3])[0]
                tx24 = rng.randint(5, 22)
            elif archetype == "travel_burst":
                amount = rng.uniform(5_000, 70_000)
                hour = rng.randint(0, 23)
                city = rng.choice([c for c in CITIES if c != home])
                category = rng.choice(["TRAVEL", "ELECTRONICS", "JEWELLERY", "FUEL"])
                entry = rng.choices(["SWIPE", "CONTACTLESS", "MANUAL"], [0.45, 0.3, 0.25])[0]
                tx24 = rng.randint(3, 12)
            else:
                # Fraud that looks entirely ordinary. Roughly a quarter of cases.
                # Without these the model learns fraud is always visible, and its
                # confidence on real traffic will be badly miscalibrated.
                amount = float(np.random.lognormal(7.4, 0.85))
                hour = int(np.clip(np.random.normal(15, 4), 6, 23))
                city = home if rng.random() < 0.6 else rng.choice(list(CITIES))
                category = rng.choice(CATEGORIES)
                entry = rng.choices(["CHIP", "CONTACTLESS", "SWIPE"], [0.4, 0.35, 0.25])[0]
                tx24 = rng.randint(0, 6)

            hours_since = _fraud_gap(rng)
            known_category = rng.random() < 0.45
        else:
            amount = float(np.random.lognormal(7.4, 0.85))
            hour = int(np.clip(np.random.normal(15, 4), 5, 23))
            # Legitimate travel is common; without it the model learns
            # "different city = fraud"
            city = home if rng.random() < 0.80 else rng.choice(list(CITIES))
            category = rng.choice(EVERYDAY) if rng.random() < 0.65 else rng.choice(CATEGORIES)
            entry = rng.choices(["CHIP", "CONTACTLESS", "SWIPE", "MANUAL"], [0.5, 0.3, 0.15, 0.05])[0]
            tx24 = rng.randint(0, 9)
            hours_since = _legit_gap(rng)
            known_category = rng.random() < 0.85

        distance = haversine(CITIES[home], CITIES[city])

        # A cardholder who flew still shows a fast implied speed. Cap the ratio
        # so travel does not become a free giveaway for either class.
        implied = distance / max(hours_since, 0.05)
        if not is_fraud and implied > 900:
            hours_since = max(hours_since, distance / rng.uniform(400, 850))
            implied = distance / max(hours_since, 0.05)

        median = float(np.random.lognormal(7.35, 0.45))
        sd = median * rng.uniform(0.35, 0.9)

        rows.append(
            {
                "amount": round(amount, 2),
                "hour": hour,
                "dayOfWeek": rng.randint(0, 6),
                "medianAmount": round(median, 2),
                "meanAmount": round(median * 1.1, 2),
                "sdAmount": round(sd, 2),
                "amountRatio": round(amount / median, 3),
                "amountZScore": round((amount - median * 1.1) / max(sd, 1), 3),
                "distanceKm": round(distance, 1),
                "hoursSinceLast": round(hours_since, 3),
                "impliedKmph": round(implied, 1),
                "txCount24h": tx24,
                "knownCategory": known_category,
                "categoryCount": rng.randint(1, 6),
                "cardTenureDays": tenure,
                "entryMode": entry,
                "merchantCategory": category,
                "city": city,
                "historyCount": history,
                "is_fraud": int(is_fraud),
            }
        )

    df = pd.DataFrame(rows).sample(frac=1, random_state=seed).reset_index(drop=True)

    # Analysts mislabel. Flip a matched number in each direction so the base
    # rate is preserved — noise should blur the boundary, not change how much
    # fraud exists. A blanket flip would quietly inflate the fraud rate and
    # make the imbalance handling meaningless.
    fraud_idx = df.index[df.is_fraud == 1]
    legit_idx = df.index[df.is_fraud == 0]
    n_flip = max(1, int(len(fraud_idx) * 0.08))

    rs = np.random.RandomState(seed)
    df.loc[rs.choice(fraud_idx, n_flip, replace=False), "is_fraud"] = 0
    df.loc[rs.choice(legit_idx, n_flip, replace=False), "is_fraud"] = 1

    return df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=60_000)
    parser.add_argument("--fraud-rate", type=float, default=0.004)
    parser.add_argument("--out", default="data/training_set.csv")
    args = parser.parse_args()

    df = synthesise(args.rows, args.fraud_rate)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)

    print(f"Wrote {len(df):,} rows to {args.out}")
    print(f"Fraud cases: {df.is_fraud.sum():,} ({df.is_fraud.mean() * 100:.2f}%)")


if __name__ == "__main__":
    main()
