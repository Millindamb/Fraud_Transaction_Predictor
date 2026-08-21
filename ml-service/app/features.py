"""Feature contract shared by training and serving.

The single most common cause of a model that scores well offline and badly in
production is training/serving skew — the two paths deriving features
differently. Both import from this module so there is exactly one definition.
"""

import numpy as np
import pandas as pd

ENTRY_MODES = ["CHIP", "CONTACTLESS", "SWIPE", "MANUAL"]
CATEGORIES = ["GROCERY", "FUEL", "RESTAURANT", "ELECTRONICS", "TRAVEL", "JEWELLERY"]

NUMERIC_FEATURES = [
    "amount_log",
    "amount_ratio",
    "amount_zscore",
    "hour_sin",
    "hour_cos",
    "is_night",
    "is_weekend",
    "distance_km",
    "implied_kmph_log",
    "hours_since_last",
    "tx_count_24h",
    "category_count",
    "card_tenure_days",
    "history_count",
    "known_category",
    "entry_mode_risk",
]

CATEGORICAL_FEATURES = [f"cat_{c}" for c in CATEGORIES]

FEATURE_ORDER = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# Analyst-facing names for the explanation panel in the UI
DISPLAY_NAMES = {
    "amount_log": "Amount",
    "amount_ratio": "Amount vs card median",
    "amount_zscore": "Amount deviation",
    "hour_sin": "Transaction hour",
    "hour_cos": "Transaction hour",
    "is_night": "Night-time authorisation",
    "is_weekend": "Weekend authorisation",
    "distance_km": "Location distance",
    "implied_kmph_log": "Implied travel speed",
    "hours_since_last": "Time since last use",
    "tx_count_24h": "Transaction frequency",
    "category_count": "Category diversity",
    "card_tenure_days": "Card tenure",
    "history_count": "History depth",
    "known_category": "Merchant category",
    "entry_mode_risk": "Entry mode",
    **{f"cat_{c}": f"Category: {c.title()}" for c in CATEGORIES},
}

# Manual entry is the strongest single entry-mode signal — chip data cannot be
# cloned the way a keyed-in PAN can.
ENTRY_MODE_RISK = {"CHIP": 0.0, "CONTACTLESS": 0.15, "SWIPE": 0.45, "MANUAL": 1.0}


def transform(raw: dict) -> dict:
    """Turn one raw feature dict from the Node service into model features."""
    amount = float(raw.get("amount") or 0.0)
    hour = int(raw.get("hour") or 0)
    day = int(raw.get("dayOfWeek") or 0)
    distance = float(raw.get("distanceKm") or 0.0)
    kmph = raw.get("impliedKmph")
    history = int(raw.get("historyCount") or 0)

    out = {
        # Transaction amounts are heavy-tailed; the log makes the scale usable
        "amount_log": float(np.log1p(max(amount, 0.0))),
        # A card with no history has no baseline — 1.0 means "exactly typical"
        "amount_ratio": float(raw.get("amountRatio") or 1.0) if history else 1.0,
        "amount_zscore": float(raw.get("amountZScore") or 0.0),
        # Hour is cyclical: 23:00 and 00:00 are adjacent, not 23 units apart
        "hour_sin": float(np.sin(2 * np.pi * hour / 24)),
        "hour_cos": float(np.cos(2 * np.pi * hour / 24)),
        "is_night": 1.0 if hour < 6 or hour >= 23 else 0.0,
        "is_weekend": 1.0 if day in (0, 6) else 0.0,
        "distance_km": distance,
        "implied_kmph_log": float(np.log1p(max(float(kmph or 0.0), 0.0))),
        "hours_since_last": float(raw.get("hoursSinceLast") or 720.0),
        "tx_count_24h": float(raw.get("txCount24h") or 0),
        "category_count": float(raw.get("categoryCount") or 0),
        "card_tenure_days": float(raw.get("cardTenureDays") or 0),
        "history_count": float(history),
        "known_category": 1.0 if raw.get("knownCategory") else 0.0,
        "entry_mode_risk": ENTRY_MODE_RISK.get(
            str(raw.get("entryMode") or "CHIP").upper(), 0.3
        ),
    }

    category = str(raw.get("merchantCategory") or "").upper()
    for c in CATEGORIES:
        out[f"cat_{c}"] = 1.0 if category == c else 0.0

    return out


def to_frame(raw_list: list[dict]) -> pd.DataFrame:
    """Vectorised transform, column order guaranteed to match FEATURE_ORDER."""
    rows = [transform(r) for r in raw_list]
    return pd.DataFrame(rows, columns=FEATURE_ORDER).astype(float)
