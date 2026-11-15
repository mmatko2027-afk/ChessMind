
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    app_name: str = "ChessMind"
    app_version: str = "0.1.0"

    llm_provider: str = "mock"
    llm_model: str = "chessmind-mock"
    llm_api_key: str = ""
    llm_timeout_s: int = Field(default=20, gt=0)

    mock_failure_mode: str = "none"

    db_path: str = "data/chessmind.db"
    log_file: str = "logs/chessmind.log"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @model_validator(mode="after")
    def validate_settings(self):

        allowed_providers = ["mock", "openai_compat"]

        if self.llm_provider not in allowed_providers:
            raise ValueError(
                "LLM_PROVIDER must be mock or openai_compat."
            )

        allowed_failures = [
            "none",
            "delay",
            "timeout",
            "rate_limit",
            "unavailable",
            "invalid_json",
            "mid_stream"
        ]

        if self.mock_failure_mode not in allowed_failures:
            raise ValueError(
                "Invalid MOCK_FAILURE_MODE value."
            )

        if self.llm_provider == "openai_compat" and not self.llm_api_key:
            raise ValueError(
                "LLM_API_KEY is required for openai_compat provider."
            )

        return self


settings = Settings()
