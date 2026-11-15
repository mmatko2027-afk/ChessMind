
import logging

from app.settings import settings
from app.models import ProviderRequest, ProviderResult
from app.providers.base import AIProvider
from app.providers.mock import MockAIProvider
from app.providers.openai_compat import OpenAICompatibleProvider
from app.providers.errors import ProviderUnavailableError


logger = logging.getLogger("chessmind")


class AIGateway:

    def __init__(self):
        self.provider: AIProvider = self._create_provider()

    def _create_provider(self) -> AIProvider:

        provider_name = settings.llm_provider.lower()

        if provider_name == "mock":
            return MockAIProvider()

        if provider_name == "openai_compat":
            return OpenAICompatibleProvider()

        raise ProviderUnavailableError(
            f"Unsupported AI provider: {provider_name}",
            retryable=False
        )

    def explain(self, request: ProviderRequest) -> ProviderResult:

        logger.info(
            "AI gateway started",
            extra={"request_id": request.request_id}
        )

        result = self.provider.explain(request)

        logger.info(
            "AI gateway completed",
            extra={"request_id": request.request_id}
        )

        return result
