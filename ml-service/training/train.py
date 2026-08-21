"""Trains the supervised model and the anomaly detector, then writes artefacts.

Read the metrics this prints carefully. Accuracy is meaningless at a 0.4% fraud
rate — a model that approves everything scores 99.6% and catches nothing. The
numbers that matter are recall at a fixed alert budget, and precision, which is
what determines whether your analysts trust the queue.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    confusion_matrix,
    precision_recall_curve,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.features import FEATURE_ORDER, to_frame  # noqa: E402


def load_dataset(path: str) -> pd.DataFrame:
    p = Path(path)
    if not p.exists():
        raise SystemExit(
            f"{path} not found. Run: python training/generate_dataset.py"
        )
    return pd.read_csv(p)


def alert_budget_recall(y_true, y_prob, budget: float) -> tuple[float, float, float]:
    """Recall and precision when only the riskiest `budget` share of traffic is
    reviewed. This is the operating point analysts actually live with — a team
    of six cannot review 5% of a million transactions."""
    k = max(1, int(len(y_prob) * budget))
    cutoff = np.sort(y_prob)[::-1][k - 1]
    flagged = y_prob >= cutoff
    tp = int(((flagged) & (y_true == 1)).sum())
    recall = tp / max(int((y_true == 1).sum()), 1)
    precision = tp / max(int(flagged.sum()), 1)
    return recall, precision, float(cutoff)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/training_set.csv")
    parser.add_argument("--version", default=None)
    args = parser.parse_args()

    version = args.version or settings.MODEL_VERSION
    df = load_dataset(args.data)

    if "is_fraud" not in df.columns:
        raise SystemExit("Dataset needs an is_fraud column (1 = fraud, 0 = legitimate).")

    y = df["is_fraud"].astype(int).values
    X = to_frame(df.drop(columns=["is_fraud"]).to_dict("records"))

    print(f"Rows: {len(df):,}   Features: {X.shape[1]}")
    print(f"Fraud rate: {y.mean() * 100:.3f}%  ({y.sum():,} cases)\n")

    if y.sum() < 30:
        print("WARNING: fewer than 30 fraud cases. Metrics will be unstable.\n")

    # Stratify — with a 0.4% positive rate a random split can leave the test set
    # with almost no fraud at all
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, stratify=y, random_state=42
    )

    scaler = StandardScaler().fit(X_train)
    X_train_s = scaler.transform(X_train)
    X_test_s = scaler.transform(X_test)

    # Class imbalance handled by sample weighting rather than resampling:
    # SMOTE-style oversampling on transaction data tends to invent cardholders
    # who never existed.
    weights = compute_sample_weight("balanced", y_train)

    print("Training supervised model (GradientBoosting)…")
    supervised = GradientBoostingClassifier(
        n_estimators=300,
        learning_rate=0.06,
        max_depth=4,
        subsample=0.85,
        min_samples_leaf=25,
        random_state=42,
    )
    supervised.fit(X_train_s, y_train, sample_weight=weights)

    print("Training anomaly detector (IsolationForest) on legitimate traffic only…")
    # Fitting on clean traffic makes "unlike normal" mean something precise
    anomaly = IsolationForest(
        n_estimators=250,
        contamination=0.01,
        max_samples="auto",
        random_state=42,
        n_jobs=-1,
    )
    anomaly.fit(X_train_s[y_train == 0])

    # ---- evaluation ----
    y_prob = supervised.predict_proba(X_test_s)[:, 1]
    roc = roc_auc_score(y_test, y_prob)
    pr_auc = average_precision_score(y_test, y_prob)

    precision, recall, thresholds = precision_recall_curve(y_test, y_prob)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-9, None)
    best_idx = int(np.nanargmax(f1[:-1])) if len(f1) > 1 else 0
    best_threshold = float(thresholds[best_idx]) if len(thresholds) else 0.5

    print("\n" + "=" * 58)
    print("EVALUATION")
    print("=" * 58)
    print(f"ROC AUC          {roc:.4f}   (optimistic under imbalance)")
    print(f"PR AUC           {pr_auc:.4f}   ← the number that matters")
    print(f"Best-F1 threshold {best_threshold:.4f}")

    print("\nOperating points by alert budget:")
    print(f"{'budget':>8} {'recall':>9} {'precision':>11} {'cutoff':>9}")
    budgets = {}
    for b in (0.001, 0.005, 0.01, 0.02, 0.05):
        r, p, c = alert_budget_recall(y_test, y_prob, b)
        budgets[f"{b:.3%}"] = {"recall": round(r, 4), "precision": round(p, 4), "cutoff": round(c, 4)}
        print(f"{b:>7.1%} {r:>9.2%} {p:>11.2%} {c:>9.4f}")

    y_pred = (y_prob >= best_threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
    print(f"\nAt the best-F1 threshold:")
    print(f"  caught {tp} fraud, missed {fn}")
    print(f"  {fp} false alarms out of {tn + fp:,} legitimate transactions")
    print("\n" + classification_report(y_test, y_pred, target_names=["legitimate", "fraud"], digits=4))

    importances = sorted(
        zip(FEATURE_ORDER, supervised.feature_importances_), key=lambda kv: kv[1], reverse=True
    )
    print("Top features:")
    for name, imp in importances[:10]:
        print(f"  {name:<22} {imp:.4f}")

    # ---- persist ----
    out_dir = Path(settings.MODEL_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    model_path = out_dir / f"fraud_model_{version}.joblib"
    meta_path = out_dir / f"metadata_{version}.json"

    joblib.dump(
        {"supervised": supervised, "anomaly": anomaly, "scaler": scaler, "features": FEATURE_ORDER},
        model_path,
        compress=3,
    )

    meta_path.write_text(
        json.dumps(
            {
                "name": "GradientBoosting+IsolationForest",
                "version": version,
                "trainedAt": datetime.now(timezone.utc).isoformat(),
                "rows": int(len(df)),
                "fraudRate": round(float(y.mean()), 6),
                "metrics": {
                    "rocAuc": round(float(roc), 4),
                    "prAuc": round(float(pr_auc), 4),
                    "bestThreshold": round(best_threshold, 4),
                    "alertBudgets": budgets,
                },
                "topFeatures": [{"feature": n, "importance": round(float(i), 4)} for n, i in importances[:10]],
            },
            indent=2,
        )
    )

    print(f"\nSaved {model_path}")
    print(f"Saved {meta_path}")
    print("\nRestart the ML service, or POST /reload, to pick it up.")


if __name__ == "__main__":
    main()
