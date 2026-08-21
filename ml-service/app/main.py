from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.model import model
from app.ulb_model import ulb_model
from app.csv_model import csv_model
from app.routes import health, predict, predict_csv, predict_ulb


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if model.load():
        print(f"Model loaded: {model.metadata.get('name')} ({settings.MODEL_VERSION})")
    else:
        # Not fatal: the Node backend falls back to its own scorer, so the
        # pipeline keeps authorising while the model is being trained.
        print("No POS model artefact found. Run: python training/train.py")

    if ulb_model.load():
        print(f"ULB model loaded: {ulb_model.metadata.get('name')}")
    else:
        print("No ULB model artefact found. Run: python training/train_ulb.py")

    if csv_model.load():
        print(f"CSV model loaded: {csv_model.metadata.get('name')}")
        # SHAP builds its explainer lazily on the first prediction, which can
        # take several seconds. Doing it here means the first real
        # authorisation is not the one that pays for it — otherwise it trips
        # the caller's timeout and silently degrades to the fallback scorer.
        try:
            csv_model.predict(
                {
                    "amount": 100.0,
                    "transaction_hour": 12,
                    "merchant_category": "Grocery",
                    "foreign_transaction": 0,
                    "location_mismatch": 0,
                    "device_trust_score": 80,
                    "velocity_last_24h": 1,
                    "cardholder_age": 40,
                }
            )
            print("CSV model warmed — SHAP explainer ready")
        except Exception as exc:
            print(f"Warm-up skipped: {exc}")
    else:
        print("No CSV model artefact found. Run: python training/train_csv.py")
    yield


app = FastAPI(
    title="FraudGuard ML Service",
    version="1.0.0",
    description="Scores POS transactions and explains why.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(predict.router, tags=["scoring"])
app.include_router(predict_ulb.router)
app.include_router(predict_csv.router)


@app.get("/")
def root():
    return {"service": "fraudguard-ml", "docs": "/docs"}