from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PORT: int = 8000
    MODEL_DIR: str = "models"
    MODEL_VERSION: str = "v1"
    ULB_MODEL_VERSION: str = "ulb_v1"
    CSV_MODEL_VERSION: str = "csv_v1"

    BACKEND_URL: str = "http://localhost:5000/api"
    BACKEND_EMAIL: str = "engineer@bank.in"
    BACKEND_PASSWORD: str = "Engineer@123"

    SUPERVISED_WEIGHT: float = 0.75
    ANOMALY_WEIGHT: float = 0.25

    EXPLAIN_ENABLED: bool = True
    EXPLAIN_TOP_K: int = 6

    @property
    def model_path(self) -> Path:
        return Path(self.MODEL_DIR) / f"fraud_model_{self.MODEL_VERSION}.joblib"

    @property
    def metadata_path(self) -> Path:
        return Path(self.MODEL_DIR) / f"metadata_{self.MODEL_VERSION}.json"


settings = Settings()
