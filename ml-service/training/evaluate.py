"""Scores a held-out CSV against a trained artefact.

Use this to compare versions before promoting one — never swap the model the
authorisation path depends on without checking what changes at your alert budget.
"""

import argparse
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.features import to_frame  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="path to a .joblib artefact")
    parser.add_argument("--data", default="data/training_set.csv")
    parser.add_argument("--budget", type=float, default=0.01)
    args = parser.parse_args()

    bundle = joblib.load(args.model)
    df = pd.read_csv(args.data)
    y = df["is_fraud"].astype(int).values
    X = bundle["scaler"].transform(to_frame(df.drop(columns=["is_fraud"]).to_dict("records")))

    prob = bundle["supervised"].predict_proba(X)[:, 1]

    k = max(1, int(len(prob) * args.budget))
    cutoff = np.sort(prob)[::-1][k - 1]
    flagged = prob >= cutoff
    tp = int((flagged & (y == 1)).sum())

    print(f"Model:     {args.model}")
    print(f"Rows:      {len(df):,}")
    print(f"ROC AUC:   {roc_auc_score(y, prob):.4f}")
    print(f"PR AUC:    {average_precision_score(y, prob):.4f}")
    print(f"\nAt a {args.budget:.1%} alert budget:")
    print(f"  recall     {tp / max(int((y == 1).sum()), 1):.2%}")
    print(f"  precision  {tp / max(int(flagged.sum()), 1):.2%}")
    print(f"  reviews/day at 100k txns: {int(100_000 * args.budget):,}")


if __name__ == "__main__":
    main()
