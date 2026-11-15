
import logging
import html

from app.settings import settings
from app.prompting import render_prompt, PROMPT_VERSION


logger = logging.getLogger("chessmind")


CONTEXT_VERSION = "v3"

MAX_TOTAL_TOKENS = 4096
CHARS_PER_TOKEN = 4


def build_context(position: str, question: str):

    base_prompt = render_prompt(
        position=position,
        question=question
    )

    reference_data = (
        "Довідкова інформація про шахові фігури:\n"
        "Король рухається на одне поле в будь-якому напрямку.\n"
        "Ферзь рухається горизонтально, вертикально та діагоналями.\n"
        "Тура рухається горизонтально та вертикально.\n"
        "Слон рухається діагоналями.\n"
        "Кінь ходить літерою Г.\n"
        "Пішак рухається вперед."
    )

    context = (
        base_prompt
        + "\n\n"
        + reference_data
    )

    available_tokens = (
        MAX_TOTAL_TOKENS - settings.llm_max_tokens
    )

    max_chars = available_tokens * CHARS_PER_TOKEN

    if len(context) > max_chars:
        context = context[:max_chars]

    logger.info(
        "Context built",
        extra={
            "context_version": CONTEXT_VERSION,
            "prompt_version": PROMPT_VERSION,
            "context_sources": [
                "prompt_template",
                "reference_data",
                "user_input"
            ],
            "context_size": len(context),
            "estimated_tokens": len(context) // CHARS_PER_TOKEN,
            "reserved_output_tokens": settings.llm_max_tokens
        }
    )

    return context
