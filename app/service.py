
import logging

from app.orchestration import ChessOrchestrator
from app.models import CoachResponse


logger = logging.getLogger("chessmind")


class ChessService:

    def __init__(self):
        self.orchestrator = ChessOrchestrator()

    def explain_position(
        self,
        question: str,
        position: str,
        request_id: str = ""
    ) -> CoachResponse:

        logger.info(
            "Chess service started",
            extra={"request_id": request_id or "-"}
        )

        result = self.orchestrator.explain(
            question=question,
            position=position,
            request_id=request_id
        )

        logger.info(
            "Chess service completed",
            extra={"request_id": result["request_id"]}
        )

        response = CoachResponse(
            answer=result["answer"],
            suggestion=result["suggestion"],
            request_id=result["request_id"]
        )

        return response
