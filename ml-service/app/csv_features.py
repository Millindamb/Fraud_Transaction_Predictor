"""Feature contract for the 10k business-feature fraud dataset.

Unlike the ULB PCA components, every column here means something an analyst can
read, so explanations from this model are directly usable in the console.

Two columns are deliberately excluded:

  transaction_id, user_id — identifiers. A tree will happily memorise
  "user 436 commits fraud", which generalises to nothing and inflates offline
  scores.

  Trashold Amount — correlates 0.008 with the label. It reads like a rule
  threshold but behaves like noise; amount exceeds it in 4% of legitimate rows
  and 8% of fraud, which is not enough signal to justify the variance it adds.
  It stays available as a rule-engine input, just not as a model feature.
"""

import numpy as np
import pandas as pd

CATEGORIES = ["Electronics", "Travel", "Grocery", "Food", "Clothing"]

BASE_FEATURES = [
    "amount_log",
    "hour_sin",
    "hour_cos",
    "is_night",
    "foreign_transaction",
    "location_mismatch",
    "device_trust_score",
    "device_distrust",
    "velocity_last_24h",
    "cardholder_age",
    "amount_per_velocity",
]
CATEGORY_FEATURES = [f"cat_{c}" for c in CATEGORIES]
FEATURE_ORDER = BASE_FEATURES + CATEGORY_FEATURES

DISPLAY_NAMES = {
    "amount_log": "Transaction amount",
    "hour_sin": "Transaction hour",
    "hour_cos": "Transaction hour",
    "is_night": "Night-time authorisation",
    "foreign_transaction": "Foreign transaction",
    "location_mismatch": "Location mismatch",
    "device_trust_score": "Device trust score",
    "device_distrust": "Device distrust",
    "velocity_last_24h": "Transaction velocity",
    "cardholder_age": "Cardholder age",
    "amount_per_velocity": "Amount per recent transaction",
    **{f"cat_{c}": f"Category: {c}" for c in CATEGORIES},
}


def transform(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)

    amount = df["amount"].astype(float).clip(lower=0)
    out["amount_log"] = np.log1p(amount)

    # Hour is cyclical — 23:00 and 00:00 are adjacent, not 23 units apart.
    # This matters here: fraud clusters at 03:00 (mean 3.8 vs 11.7 legitimate),
    # and a linear encoding would split that cluster across the wrap-around.
    hour = df["transaction_hour"].astype(float)
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    out["is_night"] = ((hour < 6) | (hour >= 22)).astype(float)

    out["foreign_transaction"] = df["foreign_transaction"].astype(float)
    out["location_mismatch"] = df["location_mismatch"].astype(float)

    trust = df["device_trust_score"].astype(float)
    out["device_trust_score"] = trust
    out["device_distrust"] = 100.0 - trust

    velocity = df["velocity_last_24h"].astype(float)
    out["velocity_last_24h"] = velocity
    # A large amount on a card already used several times today is a different
    # risk from the same amount on a quiet card
    out["amount_per_velocity"] = amount / (velocity + 1.0)

    out["cardholder_age"] = df["cardholder_age"].astype(float)

    category = df["merchant_category"].astype(str)
    for c in CATEGORIES:
        out[f"cat_{c}"] = (category == c).astype(float)

    return out[FEATURE_ORDER].astype(float)


def transform_one(record: dict) -> pd.DataFrame:
    return transform(pd.DataFrame([record]))
