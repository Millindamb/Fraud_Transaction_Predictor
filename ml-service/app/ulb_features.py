"""Feature contract for the ULB Credit Card Fraud dataset.

The dataset gives V1–V28 (PCA components), Time (seconds since the first
transaction in the two-day capture) and Amount. Only three things can honestly
be engineered on top:

  - Amount is heavily skewed, so a log transform makes the scale usable.
  - Time is seconds-since-start, which is meaningless as a raw feature and will
    leak the train/test boundary if fed in directly. It is converted to hour of
    day, cyclically encoded.
  - Everything else is already orthogonal by construction. PCA output does not
    benefit from interaction terms invented after the fact.

Resisting the urge to engineer more is the correct call here. Features built on
top of PCA components have no interpretable meaning and mostly add variance.
"""

import numpy as np
import pandas as pd

V_FEATURES = [f"V{i}" for i in range(1, 29)]
DERIVED = ["amount_log", "hour_sin", "hour_cos", "is_night"]
ULB_FEATURE_ORDER = V_FEATURES + DERIVED

SECONDS_PER_HOUR = 3600


def transform(df: pd.DataFrame) -> pd.DataFrame:
    """Raw ULB rows -> model matrix. Used identically in training and serving."""
    out = df[V_FEATURES].copy().astype(float)

    amount = df["Amount"].astype(float).clip(lower=0)
    out["amount_log"] = np.log1p(amount)

    # The capture starts at an unknown wall-clock time, so "hour" here is hours
    # since capture start modulo 24 — a relative diurnal position, not IST.
    hour = (df["Time"].astype(float) / SECONDS_PER_HOUR) % 24
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    out["is_night"] = ((hour < 6) | (hour >= 22)).astype(float)

    return out[ULB_FEATURE_ORDER]


def transform_one(record: dict) -> pd.DataFrame:
    return transform(pd.DataFrame([record]))
