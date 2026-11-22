
import json
import logging

from click import prompt
from google import genai
from google.genai import types
from pydantic import ValidationError

from app.context_builder import build_context
from app.models import (
    CoachStructuredOutput,
    ProviderRequest,
    ProviderResult,
)
from app.providers.base import AIProvider
from app.providers.errors import (
    ProviderAuthenticationError,
    ProviderInvalidResponseError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from app.settings import settings

logger = logging.getLogger("chessmind")


class GeminiNativeProvider(AIProvider):

    def __init__(self):
        self.client = genai.Client(
            api_key=settings.llm_api_key,
            http_options=types.HttpOptions(
                timeout=settings.llm_timeout_s * 1000
            ),
        )

    def explain(self, request: ProviderRequest) -> ProviderResult:
        ...
        coach_schema = types.Schema(
            type=types.Type.OBJECT,
            properties={
                "answer": types.Schema(type=types.Type.STRING),
                "suggestion": types.Schema(type=types.Type.STRING),
                "has_enough_data": types.Schema(type=types.Type.BOOLEAN),
                "missing_information": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                ),
            },
            required=["answer", "suggestion", "has_enough_data", "missing_information"],
        )

        try:
            response = self.client.models.generate_content(
                model=settings.llm_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=coach_schema,
                    max_output_tokens=settings.llm_max_tokens,
                ),
            )

            raw_text = (response.text or "").strip()

            if not raw_text:
                raise ProviderInvalidResponseError(
                    "Empty response from Gemini."
                )

            output = CoachStructuredOutput.model_validate_json(raw_text)

            usage = response.usage_metadata

            input_tokens = getattr(usage, "prompt_token_count", 0) or 0
            output_tokens = getattr(usage, "candidates_token_count", 0) or 0

            total_tokens = (
                getattr(usage, "total_token_count", 0)
                or input_tokens + output_tokens
            )

            cost = (
                input_tokens * settings.input_token_price
                + output_tokens * settings.output_token_price
            ) / 1_000_000

            return ProviderResult(
                output=output,
                provider="gemini",
                model=settings.llm_model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                cost=cost,
            )

        except (ValidationError, json.JSONDecodeError) as error:
            raise ProviderInvalidResponseError(
                "The AI service returned an invalid response."
            ) from error

        except ProviderInvalidResponseError:
            raise

        except Exception as error:
            msg = str(error).lower()

            if "401" in msg or "403" in msg or "api_key" in msg or "permission" in msg:
                raise ProviderAuthenticationError(
                    "Gemini authentication failed."
                ) from error

            if "429" in msg or "quota" in msg or "rate" in msg:
                raise ProviderRateLimitError(
                    "Перевищено ліміт запитів до AI-провайдера."
                ) from error

            if "timeout" in msg or "deadline" in msg:
                raise ProviderTimeoutError(
                    "Перевищено час очікування відповіді від AI-провайдера."
                ) from error

            raise ProviderUnavailableError(
                "AI-сервіс тимчасово недоступний."
            ) from error
