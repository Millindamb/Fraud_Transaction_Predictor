"""Serving wrapper for the business-feature model.

This one can genuinely drive the live console: every input is something a POS
pipeline can produce, so the explanations it returns are readable by an analyst
rather than being PCA component numbers.
"""

import json
import time
from pathlib import Path

import joblib
import numpy as np

from app.config import settings
from app.csv_features import DISPLAY_NAMES, FEATURE_ORDER, transform_one


class CsvModel:
    def __init__(self) -> None:
        self.bundle = None
        self.explainer = None
        self.metadata: dict = {}

    def load(self, version: str | None = None) -> bool:
        version = version or settings.CSV_MODEL_VERSION
        path = Path(settings.MODEL_DIR) / f"fraud_model_{version}.joblib"
        if not path.exists():
            return False

        bundle = joblib.load(path)
        if bundle.get("profile") != "csv":
            return False
        self.bundle = bundle

        meta = Path(settings.MODEL_DIR) / f"metadata_{version}.json"
        if meta.exists():
            self.metadata = json.loads(meta.read_text())

        if settings.EXPLAIN_ENABLED:
            try:
                import shap

                model = bundle["supervised"]
                if not hasattr(model, "coef_"):
                    self.explainer = shap.TreeExplainer(model)
            except Exception as exc:
                print(f"SHAP unavailable for CSV model: {exc}")
                self.explainer = None
        return True

    @property
    def loaded(self) -> bool:
        return self.bundle is not None

    def predict(self, record: dict, explain: bool | None = None) -> dict:
        started = time.perf_counter()
        if not self.loaded:
            raise RuntimeError("No CSV model loaded. Run training/train_csv.py.")

        X = transform_one(record)
        Xs = self.bundle["scaler"].transform(X)

        supervised_p = float(self.bundle["supervised"].predict_proba(Xs)[0][1])
        raw = float(self.bundle["anomaly"].decision_function(Xs)[0])
        anomaly_p = float(1.0 / (1.0 + np.exp(6.0 * raw)))

        w_s, w_a = settings.SUPERVISED_WEIGHT, settings.ANOMALY_WEIGHT
        probability = (supervised_p * w_s + anomaly_p * w_a) / (w_s + w_a)

        do_explain = settings.EXPLAIN_ENABLED if explain is None else explain
        explanation = self._explain(Xs) if do_explain and self.explainer else {
            "baseValue": 0.0, "contributions": []
        }

        return {
            "score": int(round(probability * 100)),
            "probability": round(probability, 4),
            "supervisedScore": int(round(supervised_p * 100)),
            "anomalyScore": int(round(anomaly_p * 100)),
            "model": {
                "name": self.metadata.get("name", "CSV model"),
                "version": settings.CSV_MODEL_VERSION,
                "confidence": round(max(probability, 1 - probability), 3),
            },
            "explanation": explanation,
            "latencyMs": int((time.perf_counter() - started) * 1000),
        }

    def _explain(self, Xs: np.ndarray) -> dict:
        values = self.explainer.shap_values(Xs)
        if isinstance(values, list):
            values = values[1]
        values = np.array(values).reshape(-1)

        base = self.explainer.expected_value
        if isinstance(base, (list, np.ndarray)):
            base = float(np.array(base).reshape(-1)[-1])

        # hour_sin/hour_cos and the two device-trust terms are one concept each
        # to an analyst; merge before ranking
        merged: dict[str, float] = {}
        for name, val in zip(FEATURE_ORDER, values):
            label = DISPLAY_NAMES.get(name, name)
            merged[label] = merged.get(label, 0.0) + float(val)

        ranked = sorted(merged.items(), key=lambda kv: abs(kv[1]), reverse=True)
        return {
            "baseValue": round(float(base), 4),
            "contributions": [
                {"feature": k, "value": round(v, 4)}
                for k, v in ranked[: settings.EXPLAIN_TOP_K] if abs(v) > 1e-6
            ],
        }


csv_model = CsvModel()
