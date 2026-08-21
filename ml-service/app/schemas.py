from typing import Any, Optional
from pydantic import BaseModel, Field


class Features(BaseModel):
    """Mirrors the output of the Node featureBuilder. Every field is optional
    because a card with no history genuinely has no z-score — the transformer
    handles the gaps rather than the caller inventing values."""

    amount: float = 0.0
    hour: int = 12
    dayOfWeek: int = 0
    medianAmount: Optional[float] = None
    meanAmount: Optional[float] = None
    sdAmount: Optional[float] = None
    amountRatio: Optional[float] = None
    amountZScore: Optional[float] = None
    distanceKm: float = 0.0
    hoursSinceLast: Optional[float] = None
    impliedKmph: Optional[float] = None
    txCount24h: int = 0
    knownCategory: bool = True
    categoryCount: int = 0
    cardTenureDays: int = 0
    entryMode: str = "CHIP"
    merchantCategory: Optional[str] = None
    city: Optional[str] = None
    historyCount: int = 0


class PredictRequest(BaseModel):
    features: Features
    explain: Optional[bool] = None


class ModelInfo(BaseModel):
    name: str
    version: str
    confidence: float


class Contribution(BaseModel):
    feature: str
    value: float


class Explanation(BaseModel):
    baseValue: float
    contributions: list[Contribution]


class PredictResponse(BaseModel):
    score: int = Field(ge=0, le=100)
    probability: float
    anomalyScore: int
    supervisedScore: int
    model: ModelInfo
    explanation: Explanation
    latencyMs: int


class HealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    modelName: Optional[str] = None
    version: Optional[str] = None
    trainedAt: Optional[str] = None
    metrics: Optional[dict[str, Any]] = None
