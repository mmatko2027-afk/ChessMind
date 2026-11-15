
import logging
import uuid

from app.gateway import AIGateway
from app.models import ProviderRequest


logger = logging.getLogger("chessmind")


class ChessOrchestrator:

    def __init__(self):
        self.gateway = AIGateway()

    def explain(
        self,
        question: str,
        position: str,
        request_id: str = ""
    ) -> dict:

        if request_id == "":
            request_id = str(uuid.uuid4())

        logger.info(
            "AI orchestration started",
            extra={"request_id": request_id}
        )

        provider_request = ProviderRequest(
            question=question,
            position=position,
            request_id=request_id
        )

        result = self.gateway.explain(provider_request)

        logger.info(
            "AI orchestration completed",
            extra={"request_id": request_id}
        )

        return {
            "answer": result.output.answer,
            "suggestion": result.output.suggestion,
            "request_id": request_id
        }
