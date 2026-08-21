from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, create_model

from app.ulb_model import ulb_model

# V1..V28 declared dynamically so the schema stays honest without 28 hand-typed lines
_v_fields = {f"V{i}": (float, Field(..., description=f"PCA component {i}")) for i in range(1, 29)}
UlbRecord = create_model(
    "UlbRecord",
    Time=(float, Field(0.0, description="Seconds since the start of the capture")),
    Amount=(float, Field(..., ge=0, description="Transaction amount")),
    **_v_fields,
)

router = APIRouter(prefix="/ulb", tags=["ulb"])


class UlbRequest(BaseModel):
    record: UlbRecord
    explain: bool | None = None


@router.post("/predict")
def predict_ulb(req: UlbRequest):
    if not ulb_model.loaded:
        raise HTTPException(
            status_code=503,
            detail="No ULB model loaded. Run: python training/train_ulb.py",
        )
    try:
        return ulb_model.predict(req.record.model_dump(), explain=req.explain)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scoring failed: {exc}") from exc


@router.post("/predict/batch")
def predict_ulb_batch(records: list[UlbRecord]):
    if not ulb_model.loaded:
        raise HTTPException(status_code=503, detail="No ULB model loaded.")
    if len(records) > 1000:
        raise HTTPException(status_code=400, detail="Send at most 1000 records per batch.")
    return {"results": [ulb_model.predict(r.model_dump(), explain=False) for r in records]}


@router.get("/info")
def ulb_info():
    if not ulb_model.loaded:
        return {"loaded": False}
    meta = ulb_model.metadata
    return {
        "loaded": True,
        "name": meta.get("name"),
        "dataset": meta.get("dataset"),
        "trainedAt": meta.get("trainedAt"),
        "split": meta.get("split"),
        "metrics": meta.get("metrics", {}),
        "allModels": [
            {k: m[k] for k in ("model", "prAuc", "rocAuc", "recall", "precision")}
            for m in meta.get("allModels", [])
        ],
    }
