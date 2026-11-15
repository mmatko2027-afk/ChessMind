
import logging
import time

from app.settings import settings
from app.models import (
    ProviderRequest,
    ProviderResult,
    CoachStructuredOutput
)
from app.providers.base import AIProvider
from app.providers.errors import (
    ProviderTimeoutError,
    ProviderRateLimitError,
    ProviderUnavailableError,
    ProviderInvalidResponseError,
    ProviderStreamError
)


logger = logging.getLogger("chessmind")


class MockAIProvider(AIProvider):

    def explain(self, request: ProviderRequest) -> ProviderResult:

        request_id = request.request_id

        logger.info(
            "Mock provider started",
            extra={"request_id": request_id}
        )

        failure_mode = settings.mock_failure_mode.lower()

        if failure_mode == "delay":
            time.sleep(3)

        elif failure_mode == "timeout":
            raise ProviderTimeoutError(
                "The AI provider timed out.",
                retryable=True
            )

        elif failure_mode == "rate_limit":
            raise ProviderRateLimitError(
                "Too many requests.",
                retryable=True
            )

        elif failure_mode == "unavailable":
            raise ProviderUnavailableError(
                "The AI provider is unavailable.",
                retryable=True
            )

        elif failure_mode == "invalid_json":
            raise ProviderInvalidResponseError(
                "The provider returned invalid JSON.",
                retryable=False
            )

        elif failure_mode == "mid_stream":
            raise ProviderStreamError(
                "The response stream was interrupted.",
                retryable=True
            )

        question_lower = request.question.lower()

        if len(request.question.strip()) < 5:
            answer = "Мені недостатньо інформації для відповіді."
            suggestion = "Будь ласка, уточніть своє запитання."
            enough_data = False
            missing_information = ["Уточнене запитання"]

        elif "кінь" in question_lower:
            answer = (
                "Кінь ходить літерою Г: "
                "на два поля в одному напрямку "
                "і на одне поле вбік."
            )
            suggestion = "Спробуйте знайти поле для ходу конем."
            enough_data = True
            missing_information = []

        elif "тура" in question_lower:
            answer = (
                "Тура рухається по горизонталі та вертикалі "
                "на будь-яку кількість вільних полів."
            )
            suggestion = "Знайдіть відкриту горизонталь або вертикаль для тури."
            enough_data = True
            missing_information = []

        elif "слон" in question_lower:
            answer = (
                "Слон рухається по діагоналі "
                "на будь-яку кількість вільних полів."
            )
            suggestion = "Слон залишається на полях одного кольору."
            enough_data = True
            missing_information = []

        elif "ферзь" in question_lower or "королева" in question_lower:
            answer = (
                "Ферзь рухається по горизонталі, вертикалі "
                "та діагоналі на будь-яку кількість вільних полів."
            )
            suggestion = "Ферзь поєднує можливості тури та слона."
            enough_data = True
            missing_information = []

        elif "король" in question_lower:
            answer = "Король рухається на одне поле в будь-якому напрямку."
            suggestion = "Стежте, щоб король не опинився під шахом."
            enough_data = True
            missing_information = []

        elif "пішак" in question_lower:
            answer = (
                "Пішак рухається вперед на одне поле, "
                "а з початкової позиції може зробити два кроки."
            )
            suggestion = "Пам'ятайте, що пішак б'є по діагоналі."
            enough_data = True
            missing_information = []

        elif "шах" in question_lower:
            answer = (
                "Шах — це ситуація, коли король "
                "перебуває під атакою суперника. "
                "Гравець повинен захистити короля, "
                "перемістити його або усунути загрозу."
            )
            suggestion = "Перевірте, чи може король втекти від атаки."
            enough_data = True
            missing_information = []

        else:
            answer = (
                "Я допоможу Вам розібратися в шахах. "
                "Уточніть, яка фігура або правило Вас цікавить."
            )
            suggestion = "Спробуйте поставити запитання про шахові фігури."
            enough_data = False
            missing_information = ["Уточнене запитання"]

        result = ProviderResult(
            output=CoachStructuredOutput(
                answer=answer,
                suggestion=suggestion,
                has_enough_data=enough_data,
                missing_information=missing_information
            ),
            provider="mock",
            model=settings.llm_model
        )

        logger.info(
            "Mock provider completed",
            extra={"request_id": request_id}
        )

        return result
