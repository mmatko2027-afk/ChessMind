
import hashlib
import json
import os

from app.settings import settings
from app.models import (
    ProviderRequest,
    ProviderResult,
    CoachStructuredOutput
)
from app.providers.base import AIProvider
from app.providers.mock import MockAIProvider
from app.providers.errors import ProviderInvalidResponseError


class RecordedAIProvider(AIProvider):

    def __init__(self):
        self.mock_provider = MockAIProvider()
        self.recordings_path = "tests/recordings/chess_coach"
        self.mode = settings.recorded_mode

    def get_request_hash(self, request):
        request_data = {
            "model": settings.llm_model,
            "position": request.position,
            "question": request.question,
            "temperature": settings.llm_temperature,
            "max_tokens": settings.llm_max_tokens
        }

        request_text = json.dumps(
            request_data,
            ensure_ascii=False,
            sort_keys=True
        )

        return hashlib.sha256(
            request_text.encode("utf-8")
        ).hexdigest()

    def explain(self, request):
        request_hash = self.get_request_hash(request)

        file_path = os.path.join(
            self.recordings_path,
            request_hash + ".json"
        )

        if self.mode == "replay":
            if not os.path.exists(file_path):
                raise ProviderInvalidResponseError(
                    "Збереженого запису для цього запиту немає."
                )

            with open(file_path, "r", encoding="utf-8") as file:
                saved_data = json.load(file)

            output = CoachStructuredOutput.model_validate(
                saved_data["output"]
            )

            return ProviderResult(
                output=output,
                provider="recorded",
                model=saved_data["model"]
            )

        if self.mode == "passthrough":
            result = self.mock_provider.explain(request)

            return ProviderResult(
                output=result.output,
                provider="recorded",
                model=result.model
            )

        if self.mode == "record":
            result = self.mock_provider.explain(request)

            saved_data = {
                "output": result.output.model_dump(),
                "model": result.model
            }

            os.makedirs(self.recordings_path, exist_ok=True)

            with open(file_path, "w", encoding="utf-8") as file:
                json.dump(
                    saved_data,
                    file,
                    ensure_ascii=False,
                    indent=4
                )

            return ProviderResult(
                output=result.output,
                provider="recorded",
                model=result.model
            )

        raise ProviderInvalidResponseError(
            "Невідомий режим Recorded Provider."
        )
