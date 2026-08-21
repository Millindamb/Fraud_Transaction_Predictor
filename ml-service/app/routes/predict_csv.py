from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.csv_model import csv_model

router = APIRouter(prefix="/csv", tags=["csv"])


class CsvRecord(BaseModel):
    amount: float = Field(..., ge=0)
    transaction_hour: int = Field(..., ge=0, le=23)
    merchant_category: Literal["Electronics", "Travel", "Grocery", "Food", "Clothing"]
    foreign_transaction: int = Field(0, ge=0, le=1)
    location_mismatch: int = Field(0, ge=0, le=1)
    device_trust_score: int = Field(..., ge=0, le=100)
    velocity_last_24h: int = Field(0, ge=0)
    cardholder_age: int = Field(35, ge=18, le=120)


class CsvRequest(BaseModel):
    record: CsvRecord
    explain: Optional[bool] = None


@router.post("/predict")
def predict_csv(req: CsvRequest):
    if not csv_model.loaded:
        raise HTTPException(
            status_code=503,
            detail="No CSV model loaded. Run: python training/train_csv.py",
        )
    try:
        return csv_model.predict(req.record.model_dump(), explain=req.explain)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scoring failed: {exc}") from exc


@router.get("/info")
def csv_info():
    if not csv_model.loaded:
        return {"loaded": False}
    m = csv_model.metadata
    return {
        "loaded": True,
        "name": m.get("name"),
        "dataset": m.get("dataset"),
        "trainedAt": m.get("trainedAt"),
        "split": m.get("split"),
        "rows": m.get("rows"),
        "fraudRate": m.get("fraudRate"),
        "metrics": m.get("metrics", {}),
        "allModels": [
            {k: x.get(k) for k in ("model", "cvPrAucMean", "cvPrAucStd",
                                   "testPrAuc", "recall", "precision")}
            for x in m.get("allModels", [])
        ],
    }
