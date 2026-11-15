
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    app_name: str = "ChessMind"
    app_version: str = "0.1.0"

    # AI provider settings
    llm_provider: str = "mock"
    llm_model: str = "chessmind-mock"
    llm_api_key: str = ""
    llm_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    llm_timeout_s: int = Field(default=20, gt=0)
    llm_temperature: float = Field(default=0.2, ge=0, le=2)
    llm_max_tokens: int = Field(default=600, gt=0)
    daily_ai_budget: float = Field(default=1.0, gt=0)
    input_token_price: float = Field(default=0.0, ge=0)
    output_token_price: float = Field(default=0.0, ge=0)
    daily_ai_request_limit: int = Field(default=100, gt=0)
    recorded_mode: str = "record"
    # Mock provider settings
    mock_failure_mode: str = "none"

    # Storage and logs
    db_path: str = "data/chessmind.db"
    log_file: str = "logs/chessmind.log"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @model_validator(mode="after")
    def validate_settings(self):

        allowed_providers = [
            "mock",
            "recorded",
            "openai_compat"
        ]

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

        if self.recorded_mode not in [
            "record",
            "replay",
            "passthrough"
        ]:
            raise ValueError("Невідомий режим Recorded Provider.")

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
