"""Serving wrapper for the ULB-trained model.

Kept separate from app/model.py because the two consume genuinely different
inputs: the POS model takes business features (amount ratio, distance, entry
mode), this one takes PCA components. Forcing them behind one interface would
mean pretending a POS terminal can produce V1–V28, which it cannot.
"""

import json
import time
from pathlib import Path

import joblib
import numpy as np

from app.config import settings
from app.ulb_features import ULB_FEATURE_ORDER, transform_one


class UlbModel:
    def __init__(self) -> None:
        self.bundle = None
        self.explainer = None
        self.metadata: dict = {}

    def load(self, version: str | None = None) -> bool:
        version = version or settings.ULB_MODEL_VERSION
        path = Path(settings.MODEL_DIR) / f"fraud_model_{version}.joblib"
        if not path.exists():
            return False

        bundle = joblib.load(path)
        if bundle.get("profile") != "ulb":
            return False
        self.bundle = bundle

        meta = Path(settings.MODEL_DIR) / f"metadata_{version}.json"
        if meta.exists():
            self.metadata = json.loads(meta.read_text())

        if settings.EXPLAIN_ENABLED:
            try:
                import shap

                model = bundle["supervised"]
                # TreeExplainer covers the tree models; LogisticRegression needs
                # the linear explainer, and a background sample.
                if hasattr(model, "coef_"):
                    self.explainer = None  # linear explainer needs data; skip
                else:
                    self.explainer = shap.TreeExplainer(model)
            except Exception as exc:
                print(f"SHAP unavailable for ULB model: {exc}")
                self.explainer = None

        return True

    @property
    def loaded(self) -> bool:
        return self.bundle is not None

    def predict(self, record: dict, explain: bool | None = None) -> dict:
        started = time.perf_counter()
        if not self.loaded:
            raise RuntimeError("No ULB model loaded. Run training/train_ulb.py.")

        X = transform_one(record)
        Xs = self.bundle["scaler"].transform(X)

        supervised_p = float(self.bundle["supervised"].predict_proba(Xs)[0][1])
        raw = float(self.bundle["anomaly"].decision_function(Xs)[0])
        anomaly_p = float(1.0 / (1.0 + np.exp(6.0 * raw)))

        w_s, w_a = settings.SUPERVISED_WEIGHT, settings.ANOMALY_WEIGHT
        probability = (supervised_p * w_s + anomaly_p * w_a) / (w_s + w_a)

        do_explain = settings.EXPLAIN_ENABLED if explain is None else explain
        explanation = self._explain(Xs) if do_explain and self.explainer else {
            "baseValue": 0.0,
            "contributions": [],
        }

        return {
            "score": int(round(probability * 100)),
            "probability": round(probability, 4),
            "supervisedScore": int(round(supervised_p * 100)),
            "anomalyScore": int(round(anomaly_p * 100)),
            "model": {
                "name": self.metadata.get("name", "ULB model"),
                "version": settings.ULB_MODEL_VERSION,
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

        ranked = sorted(
            zip(ULB_FEATURE_ORDER, values), key=lambda kv: abs(kv[1]), reverse=True
        )[: settings.EXPLAIN_TOP_K]

        return {
            "baseValue": round(float(base), 4),
            # V-component names are all this model can honestly offer. They carry
            # no business meaning — that is a property of the anonymised dataset,
            # not a gap in the implementation.
            "contributions": [
                {"feature": name, "value": round(float(v), 4)} for name, v in ranked
            ],
            "note": "V1–V28 are anonymised PCA components and have no business interpretation.",
        }


ulb_model = UlbModel()
