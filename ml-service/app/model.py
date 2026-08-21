import json
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np

from app.config import settings
from app.features import DISPLAY_NAMES, FEATURE_ORDER, to_frame


class FraudModel:
    """Holds the trained artefacts and turns a feature dict into a 0–100 score.

    Two models run together:
      - GradientBoosting (supervised) learns the fraud patterns present in the
        labelled data.
      - IsolationForest (unsupervised) flags transactions unlike anything in the
        training set at all. This is what catches an attack pattern that has
        never been labelled, which is precisely where a purely supervised model
        is blind.
    """

    def __init__(self) -> None:
        self.bundle = None
        self.explainer = None
        self.metadata: dict = {}

    # ---------- loading ----------

    def load(self) -> bool:
        path = Path(settings.model_path)
        if not path.exists():
            return False

        self.bundle = joblib.load(path)

        meta_path = Path(settings.metadata_path)
        if meta_path.exists():
            self.metadata = json.loads(meta_path.read_text())

        if settings.EXPLAIN_ENABLED:
            try:
                import shap

                self.explainer = shap.TreeExplainer(self.bundle["supervised"])
            except Exception as exc:  # explanation is optional, scoring is not
                print(f"SHAP explainer unavailable: {exc}")
                self.explainer = None

        return True

    @property
    def loaded(self) -> bool:
        return self.bundle is not None

    # ---------- scoring ----------

    def _anomaly_score(self, X_scaled: np.ndarray) -> float:
        """IsolationForest decision_function: higher means more normal.
        Flip and squash it into 0–1 where 1 means most anomalous."""
        raw = float(self.bundle["anomaly"].decision_function(X_scaled)[0])
        return float(1.0 / (1.0 + np.exp(6.0 * raw)))

    def predict(self, raw_features: dict, explain: Optional[bool] = None) -> dict:
        started = time.perf_counter()
        if not self.loaded:
            raise RuntimeError("No trained model is loaded. Run training/train.py first.")

        X = to_frame([raw_features])
        X_scaled = self.bundle["scaler"].transform(X)

        supervised_p = float(self.bundle["supervised"].predict_proba(X_scaled)[0][1])
        anomaly_p = self._anomaly_score(X_scaled)

        w_s, w_a = settings.SUPERVISED_WEIGHT, settings.ANOMALY_WEIGHT
        probability = (supervised_p * w_s + anomaly_p * w_a) / (w_s + w_a)

        do_explain = settings.EXPLAIN_ENABLED if explain is None else explain
        explanation = (
            self._explain(X_scaled, X) if do_explain and self.explainer else
            {"baseValue": 0.0, "contributions": []}
        )

        return {
            "score": int(round(probability * 100)),
            "probability": round(probability, 4),
            "supervisedScore": int(round(supervised_p * 100)),
            "anomalyScore": int(round(anomaly_p * 100)),
            "model": {
                "name": self.metadata.get("name", "GradientBoosting+IsolationForest"),
                "version": settings.MODEL_VERSION,
                "confidence": round(max(probability, 1 - probability), 3),
            },
            "explanation": explanation,
            "latencyMs": int((time.perf_counter() - started) * 1000),
        }

    def _explain(self, X_scaled: np.ndarray, X_raw) -> dict:
        values = self.explainer.shap_values(X_scaled)
        if isinstance(values, list):  # older SHAP returns one array per class
            values = values[1]
        values = np.array(values).reshape(-1)

        base = self.explainer.expected_value
        if isinstance(base, (list, np.ndarray)):
            base = float(np.array(base).reshape(-1)[-1])

        # hour_sin and hour_cos are one concept to an analyst; merge display duplicates
        merged: dict[str, float] = {}
        for name, val in zip(FEATURE_ORDER, values):
            label = DISPLAY_NAMES.get(name, name)
            merged[label] = merged.get(label, 0.0) + float(val)

        ranked = sorted(merged.items(), key=lambda kv: abs(kv[1]), reverse=True)
        top = ranked[: settings.EXPLAIN_TOP_K]

        return {
            "baseValue": round(float(base), 4),
            "contributions": [
                {"feature": k, "value": round(v, 4)} for k, v in top if abs(v) > 1e-6
            ],
        }


model = FraudModel()
