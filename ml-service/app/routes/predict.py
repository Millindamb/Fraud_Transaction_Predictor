from fastapi import APIRouter, HTTPException

from app.model import model
from app.schemas import PredictRequest, PredictResponse

router = APIRouter()


@router.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if not model.loaded:
        raise HTTPException(
            status_code=503,
            detail="No trained model is loaded. Run training/train.py, then restart the service.",
        )
    try:
        return model.predict(req.features.model_dump(), explain=req.explain)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scoring failed: {exc}") from exc


@router.post("/predict/batch")
def predict_batch(items: list[PredictRequest]):
    if not model.loaded:
        raise HTTPException(status_code=503, detail="No trained model is loaded.")
    if len(items) > 500:
        raise HTTPException(status_code=400, detail="Send at most 500 transactions per batch.")
    return {
        "results": [model.predict(i.features.model_dump(), explain=i.explain) for i in items]
    }
