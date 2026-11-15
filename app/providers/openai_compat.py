
import logging

from app.models import ProviderRequest, ProviderResult
from app.providers.base import AIProvider
from app.providers.errors import ProviderUnavailableError


logger = logging.getLogger("chessmind")


class OpenAICompatibleProvider(AIProvider):

    def explain(self, request: ProviderRequest) -> ProviderResult:

        logger.info(
            "OpenAI-compatible provider requested",
            extra={"request_id": request.request_id}
        )

        raise ProviderUnavailableError(
            "The real AI provider is not implemented yet.",
            retryable=False
        )
