from fastapi import APIRouter

from app.config import settings
from app.model import model
from app.ulb_model import ulb_model
from app.csv_model import csv_model
from app.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health():
    return {
        "status": "ok" if model.loaded else "degraded",
        "modelLoaded": model.loaded,
        "modelName": model.metadata.get("name"),
        "version": settings.MODEL_VERSION,
        "trainedAt": model.metadata.get("trainedAt"),
        "metrics": model.metadata.get("metrics"),
    }


@router.post("/reload")
def reload_model():
    """Called after a retrain so the running service picks up new artefacts
    without dropping in-flight authorisations."""
    ok = model.load()
    ulb_ok = ulb_model.load()
    csv_ok = csv_model.load()
    return {"reloaded": ok, "ulbReloaded": ulb_ok,
            "version": settings.MODEL_VERSION,
            "ulbVersion": settings.ULB_MODEL_VERSION,
            "csvReloaded": csv_ok,
            "csvVersion": settings.CSV_MODEL_VERSION}
