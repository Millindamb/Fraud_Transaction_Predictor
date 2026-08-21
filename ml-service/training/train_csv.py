"""Trains fraud models on the 10k business-feature dataset.

  python training/train_csv.py

Methodology notes worth defending in a viva:

STRATIFIED SPLIT, WITH CROSS-VALIDATION. There is no time column here, so a
temporal split is neither possible nor required — a stratified random split is
correct. But 151 fraud cases across 10,000 rows means a single 20% test set
holds only ~30 fraud examples, and one lucky split can swing recall by ten
points. Every headline number is therefore reported as a 5-fold cross-validated
mean with its standard deviation, and the held-out test set is used once at the
end. A single split on data this small is not a measurement, it is an anecdote.

NO SMOTE. Class weighting rebalances without fabricating cardholders who never
existed, and cannot leak across the split the way pre-split resampling does.

THRESHOLD FROM CROSS-VALIDATED PREDICTIONS, not from the test set.
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    confusion_matrix,
    precision_recall_curve,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.csv_features import DISPLAY_NAMES, FEATURE_ORDER, transform  # noqa: E402

REQUIRED = {
    "amount", "transaction_hour", "merchant_category", "foreign_transaction",
    "location_mismatch", "device_trust_score", "velocity_last_24h",
    "cardholder_age", "is_fraud",
}


def load(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise SystemExit(f"{path} not found.")
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    missing = REQUIRED - set(df.columns)
    if missing:
        raise SystemExit(f"Dataset is missing columns: {sorted(missing)}")
    return df


def alert_budget_table(y_true, y_prob) -> dict:
    rows, order = {}, np.sort(y_prob)[::-1]
    total_fraud = max(int(np.sum(y_true)), 1)
    for budget in (0.005, 0.01, 0.02, 0.05, 0.10):
        k = max(1, int(len(y_prob) * budget))
        cutoff = order[k - 1]
        flagged = y_prob >= cutoff
        tp = int((flagged & (y_true == 1)).sum())
        rows[f"{budget:.1%}"] = {
            "reviews": int(flagged.sum()),
            "caught": tp,
            "recall": round(tp / total_fraud, 4),
            "precision": round(tp / max(int(flagged.sum()), 1), 4),
            "cutoff": round(float(cutoff), 6),
        }
    return rows


def best_threshold(y_true, y_prob) -> float:
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    if len(thresholds) == 0:
        return 0.5
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-12, None)
    return float(thresholds[int(np.nanargmax(f1[:-1]))])


def economics(y_true, y_pred, amounts, review_cost) -> dict:
    missed = amounts[(y_true == 1) & (y_pred == 0)].sum()
    caught = amounts[(y_true == 1) & (y_pred == 1)].sum()
    fa = int(((y_true == 0) & (y_pred == 1)).sum())
    return {
        "fraudValuePrevented": round(float(caught), 2),
        "fraudValueMissed": round(float(missed), 2),
        "falseAlarms": fa,
        "reviewCost": round(fa * review_cost, 2),
        "netBenefit": round(float(caught) - fa * review_cost, 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/csv/transactions.csv")
    parser.add_argument("--version", default="csv_v1")
    parser.add_argument("--review-cost", type=float, default=20.0)
    parser.add_argument("--folds", type=int, default=5)
    args = parser.parse_args()

    df = load(Path(args.data))
    y_all = df.is_fraud.astype(int).values

    print("=" * 66)
    print("FRAUD DETECTION — BUSINESS-FEATURE DATASET")
    print("=" * 66)
    print(f"Rows          {len(df):,}")
    print(f"Fraud cases   {int(y_all.sum()):,}  ({y_all.mean() * 100:.3f}%)")
    print(f"Imbalance     1 : {int((1 - y_all.mean()) / y_all.mean())}")
    print(f"Features used {len(FEATURE_ORDER)}  (transaction_id, user_id and "
          f"'Trashold Amount' excluded — see app/csv_features.py)")

    X_all = transform(df)

    X_tr, X_te, y_tr, y_te, amt_tr, amt_te = train_test_split(
        X_all, y_all, df.amount.values, test_size=0.2, stratify=y_all, random_state=42
    )
    print(f"\nStratified split   train {len(X_tr):,} ({y_tr.sum()} fraud)   "
          f"test {len(X_te):,} ({y_te.sum()} fraud)")
    print(f"Cross-validation   {args.folds}-fold on the training set")

    scaler = StandardScaler().fit(X_tr)
    Xtr, Xte = scaler.transform(X_tr), scaler.transform(X_te)

    candidates = {
        "LogisticRegression": LogisticRegression(
            max_iter=2000, class_weight="balanced", C=0.5, solver="liblinear"
        ),
        "RandomForest": RandomForestClassifier(
            n_estimators=400, max_depth=10, min_samples_leaf=4,
            class_weight="balanced_subsample", n_jobs=-1, random_state=42
        ),
        "GradientBoosting": GradientBoostingClassifier(
            n_estimators=250, learning_rate=0.07, max_depth=3,
            subsample=0.85, min_samples_leaf=15, random_state=42
        ),
    }

    cv = StratifiedKFold(n_splits=args.folds, shuffle=True, random_state=42)
    results, fitted = [], {}

    for name, clf in candidates.items():
        print(f"\nTraining {name}…", flush=True)
        t0 = time.perf_counter()

        # Out-of-fold predictions: every row is scored by a model that never saw it
        oof = cross_val_predict(clf, Xtr, y_tr, cv=cv, method="predict_proba", n_jobs=-1)[:, 1]
        cv_pr = [
            average_precision_score(y_tr[te], oof[te]) for _, te in cv.split(Xtr, y_tr)
        ]

        clf.fit(Xtr, y_tr)
        thr = best_threshold(y_tr, oof)
        prob_te = clf.predict_proba(Xte)[:, 1]
        pred_te = (prob_te >= thr).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_te, pred_te).ravel()

        summary = {
            "model": name,
            "cvPrAucMean": round(float(np.mean(cv_pr)), 4),
            "cvPrAucStd": round(float(np.std(cv_pr)), 4),
            "testPrAuc": round(float(average_precision_score(y_te, prob_te)), 4),
            "testRocAuc": round(float(roc_auc_score(y_te, prob_te)), 4),
            "threshold": round(thr, 6),
            "truePositives": int(tp), "falseNegatives": int(fn),
            "falsePositives": int(fp), "trueNegatives": int(tn),
            "recall": round(tp / max(tp + fn, 1), 4),
            "precision": round(tp / max(tp + fp, 1), 4),
            "f1": round(2 * tp / max(2 * tp + fp + fn, 1), 4),
            "alertBudgets": alert_budget_table(y_te, prob_te),
            "economics": economics(y_te, pred_te, amt_te, args.review_cost),
            "trainSeconds": round(time.perf_counter() - t0, 1),
        }
        results.append(summary)
        fitted[name] = clf
        print(f"  CV PR AUC {summary['cvPrAucMean']:.4f} ± {summary['cvPrAucStd']:.4f}"
              f"   test {summary['testPrAuc']:.4f}"
              f"   recall {summary['recall']:.2%}   precision {summary['precision']:.2%}")

    print("\nTraining IsolationForest (legitimate rows only)…", flush=True)
    iso = IsolationForest(n_estimators=250, contamination=0.015, random_state=42, n_jobs=-1)
    iso.fit(Xtr[y_tr == 0])
    iso_prob = 1.0 / (1.0 + np.exp(6.0 * iso.decision_function(Xte)))
    print(f"  test PR AUC {average_precision_score(y_te, iso_prob):.4f}"
          f"   (expected to trail — it never sees a label)")

    champion = max(results, key=lambda r: r["cvPrAucMean"])
    best = fitted[champion["model"]]

    print("\n" + "=" * 66)
    print("RESULTS")
    print("=" * 66)
    print(f"{'model':<20}{'CV PR AUC':>18}{'test PR':>9}{'recall':>9}{'prec':>8}{'FP':>6}")
    for r in results:
        print(f"{r['model']:<20}{r['cvPrAucMean']:>11.4f} ±{r['cvPrAucStd']:.3f}"
              f"{r['testPrAuc']:>9.4f}{r['recall']:>9.2%}{r['precision']:>8.2%}{r['falsePositives']:>6}")

    print(f"\nChampion: {champion['model']}")
    print("Selected on cross-validated PR AUC, not the single test split — with "
          f"{int(y_all.sum())} fraud cases\none split is too noisy to choose on.")

    print(f"\nAlert budgets — {champion['model']} (test set)")
    print(f"{'budget':>8}{'reviews':>9}{'caught':>8}{'recall':>9}{'precision':>11}")
    for b, row in champion["alertBudgets"].items():
        print(f"{b:>8}{row['reviews']:>9}{row['caught']:>8}"
              f"{row['recall']:>9.2%}{row['precision']:>11.2%}")

    e = champion["economics"]
    print(f"\nEconomics at the chosen threshold (review cost {args.review_cost:.0f}/alert)")
    print(f"  fraud value prevented  {e['fraudValuePrevented']:>11,.2f}")
    print(f"  fraud value missed     {e['fraudValueMissed']:>11,.2f}")
    print(f"  false alarms           {e['falseAlarms']:>11,}")
    print(f"  net benefit            {e['netBenefit']:>11,.2f}")

    prob_te = best.predict_proba(Xte)[:, 1]
    print("\n" + classification_report(
        y_te, (prob_te >= champion["threshold"]).astype(int),
        target_names=["legitimate", "fraud"], digits=4, zero_division=0))

    if hasattr(best, "feature_importances_"):
        merged = {}
        for name, imp in zip(FEATURE_ORDER, best.feature_importances_):
            label = DISPLAY_NAMES.get(name, name)
            merged[label] = merged.get(label, 0.0) + float(imp)
        print("Feature importance:")
        for label, imp in sorted(merged.items(), key=lambda kv: -kv[1])[:10]:
            bar = "#" * int(imp * 60)
            print(f"  {label:<30}{imp:.4f}  {bar}")

    out_dir = Path("models")
    out_dir.mkdir(parents=True, exist_ok=True)
    model_path = out_dir / f"fraud_model_{args.version}.joblib"
    meta_path = out_dir / f"metadata_{args.version}.json"

    joblib.dump(
        {"supervised": best, "anomaly": iso, "scaler": scaler,
         "features": FEATURE_ORDER, "profile": "csv",
         "threshold": champion["threshold"]},
        model_path, compress=3,
    )
    meta_path.write_text(json.dumps({
        "name": f"CSV-{champion['model']}",
        "profile": "csv",
        "version": args.version,
        "dataset": Path(args.data).name,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "rows": int(len(df)),
        "fraudRate": round(float(y_all.mean()), 6),
        "split": f"stratified 80/20, {args.folds}-fold CV on train",
        "metrics": champion,
        "allModels": results,
    }, indent=2))

    print(f"\nSaved {model_path}")
    print(f"Saved {meta_path}")
    print(f"\nServe it: add CSV_MODEL_VERSION={args.version} to .env, restart the service")


if __name__ == "__main__":
    main()
