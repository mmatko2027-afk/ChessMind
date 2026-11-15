
import logging

from openai import (
    OpenAI,
    APITimeoutError,
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    RateLimitError
)
from pydantic import ValidationError

from app.settings import settings
from app.context_builder import build_context
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
    ProviderAuthenticationError,
    ProviderBadRequestError,
    ProviderInvalidResponseError
)


logger = logging.getLogger("chessmind")


class OpenAICompatibleProvider(AIProvider):

    def __init__(self):
        self.client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout_s,
            max_retries=0
        )

    def _handle_error(self, error):

        if isinstance(error, APITimeoutError):
            raise ProviderTimeoutError(
                "The AI service request timed out."
            )

        if isinstance(error, RateLimitError):
            raise ProviderRateLimitError(
                "The AI service request limit was reached."
            )

        if isinstance(error, APIConnectionError):
            raise ProviderUnavailableError(
                "The AI service is unavailable."
            )

        if isinstance(error, InternalServerError):
            raise ProviderUnavailableError(
                "The AI service returned a server error."
            )

        if isinstance(error, AuthenticationError):
            raise ProviderAuthenticationError(
                "The AI service rejected the API key."
            )

        if isinstance(error, BadRequestError):
            raise ProviderBadRequestError(
                "The AI service rejected the request."
            )

        if isinstance(error, APIStatusError):
            if error.status_code >= 500:
                raise ProviderUnavailableError(
                    "The AI service returned a server error."
                )

            raise ProviderBadRequestError(
                "The AI service could not process the request."
            )

        raise ProviderUnavailableError(
            "An unexpected AI service error occurred.",
            retryable=False
        )

    def explain(self, request: ProviderRequest) -> ProviderResult:

        logger.info(
            "OpenAI-compatible provider requested",
            extra={"request_id": request.request_id}
        )

        prompt = build_context(
            position=request.position,
            question=request.question
        )

        messages = [
            {
                "role": "user",
                "content": prompt
            }
        ]

        for attempt in range(2):

            try:
                try:
                    response = self.client.chat.completions.create(
                        model=settings.llm_model,
                        messages=messages,
                        temperature=settings.llm_temperature,
                        max_tokens=settings.llm_max_tokens,
                        response_format={
                            "type": "json_schema",
                            "json_schema": {
                                "name": "chess_coach_response",
                                "strict": True,
                                "schema": CoachStructuredOutput.model_json_schema()
                            }
                        }
                    )

                except BadRequestError as error:

                    error_text = str(error).lower()

                    if (
                        "json_schema" not in error_text
                        and "response_format" not in error_text
                    ):
                        raise

                    logger.warning(
                        "Using JSON object mode",
                        extra={"request_id": request.request_id}
                    )

                    response = self.client.chat.completions.create(
                        model=settings.llm_model,
                        messages=messages,
                        temperature=settings.llm_temperature,
                        max_tokens=settings.llm_max_tokens,
                        response_format={
                            "type": "json_object"
                        }
                    )

                if not response.choices:
                    raise ValueError("Empty response")

                content = response.choices[0].message.content

                if not content:
                    raise ValueError("Empty response")

                output = CoachStructuredOutput.model_validate_json(
                    content
                )

                logger.info(
                    "OpenAI-compatible provider completed",
                    extra={"request_id": request.request_id}
                )

                usage = response.usage

                input_tokens = 0
                output_tokens = 0
                total_tokens = 0
                cost = 0.0

                if usage is not None:
                    input_tokens = usage.prompt_tokens or 0
                    output_tokens = usage.completion_tokens or 0
                    total_tokens = usage.total_tokens or 0

                    input_cost = (
                        input_tokens
                        * settings.input_token_price
                        / 1000000
                    )

                    output_cost = (
                        output_tokens
                        * settings.output_token_price
                        / 1000000
                    )

                    cost = input_cost + output_cost

                return ProviderResult(
                    output=output,
                    provider="openai_compat",
                    model=settings.llm_model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_tokens=total_tokens,
                    cost=cost
                )
            except (ValueError, ValidationError) as error:

                logger.warning(
                    "Invalid AI response",
                    extra={
                        "request_id": request.request_id,
                        "attempt": attempt + 1
                    }
                )

                if attempt == 0:
                    messages.append({
                        "role": "user",
                        "content": (
                            "Попередня відповідь мала неправильний формат. "
                            "Поверни правильний JSON відповідно до заданої схеми. "
                            "Не додавай текст поза JSON."
                        )
                    })
                    continue

                raise ProviderInvalidResponseError(
                    "The AI service returned an invalid response."
                ) from error

            except (
                APITimeoutError,
                RateLimitError,
                APIConnectionError,
                InternalServerError,
                AuthenticationError,
                BadRequestError,
                APIStatusError
            ) as error:

                logger.error(
                    "AI provider request failed",
                    extra={
                        "request_id": request.request_id,
                        "error_type": type(error).__name__
                    }
                )

                self._handle_error(error)
