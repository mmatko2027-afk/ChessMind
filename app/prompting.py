
import logging
import html

logger = logging.getLogger("chessmind")


PROMPT_PATH = "prompts/chess_coach/v1.md"
PROMPT_VERSION = "v1"


def load_prompt():

    with open(PROMPT_PATH, "r", encoding="utf-8") as file:
        prompt = file.read()

    logger.info(
        "Prompt loaded",
        extra={"prompt_version": PROMPT_VERSION}
    )

    return prompt


def render_prompt(position: str, question: str):

    prompt = load_prompt()

    safe_position = html.escape(position)
    safe_question = html.escape(question)

    prompt = prompt.replace("{position}", safe_position)
    prompt = prompt.replace("{question}", safe_question)

    return prompt
