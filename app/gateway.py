import logging

from app.storage import ChessStorage
from app.settings import settings
from app.models import ProviderRequest, ProviderResult
from app.providers.base import AIProvider
from app.providers.mock import MockAIProvider
from app.providers.openai_compat import OpenAICompatibleProvider
from app.providers.errors import ProviderUnavailableError
from app.providers.recorded import RecordedAIProvider
from app.providers.gemini_native import GeminiNativeProvider

logger = logging.getLogger("chessmind")


class AIGateway:

    def __init__(self):
        self.storage = ChessStorage()
        self.provider: AIProvider = self._create_provider()

    def _create_provider(self) -> AIProvider:

        provider_name = settings.llm_provider.lower()

        if provider_name == "mock":
            return MockAIProvider()

        if provider_name == "recorded":
            return RecordedAIProvider()

        if provider_name == "openai_compat":
            return OpenAICompatibleProvider()

        if provider_name == "gemini":
            return GeminiNativeProvider()

        raise ProviderUnavailableError(
            f"Unsupported AI provider: {provider_name}",
            retryable=False
        )

    def explain(self, request: ProviderRequest) -> ProviderResult:

        logger.info(
            "AI gateway started",
            extra={"request_id": request.request_id}
        )

        self.storage.check_ai_limits()

        self.storage.record_ai_request()

        result = self.provider.explain(request)

        self.storage.record_ai_usage(
            cost=result.cost,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens
        )

        logger.info(
            "AI gateway completed",
            extra={
                "request_id": request.request_id,
                "provider": result.provider,
                "model": result.model,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "total_tokens": result.total_tokens,
                "cost": result.cost
            }
        )

        return result
