
from typing import Literal

from pydantic import BaseModel, Field


class GameCreateRequest(BaseModel):
    level: Literal["beginner", "intermediate", "advanced"] = "beginner"
    opponent: Literal["computer", "human"] = "computer"
    assistant_position: Literal["right", "left", "bottom"] = "right"
    assistant_appearance: str = "owl"
    voice_enabled: bool = False


class GameResponse(BaseModel):
    game_id: str
    status: str
    level: str
    current_turn: str


class CoachRequest(BaseModel):
    game_id: str | None = None
    question: str = Field(min_length=1, max_length=1000)
    position: str = "current"


class CoachResponse(BaseModel):
    answer: str
    suggestion: str
    request_id: str
    has_enough_data: bool = True
    missing_information: list[str] = Field(default_factory=list)


class CoachStructuredOutput(BaseModel):
    answer: str = Field(min_length=1)
    suggestion: str = Field(min_length=1)
    has_enough_data: bool
    missing_information: list[str]

    model_config = {
        "extra": "forbid"
    }


class ProviderRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    position: str
    request_id: str


class ProviderResult(BaseModel):
    output: CoachStructuredOutput
    provider: str
    model: str

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cost: float = 0.0


class ErrorDetail(BaseModel):
    kind: str
    message: str
    retryable: bool
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class MoveRequest(BaseModel):
    move: str


class MoveResponse(BaseModel):
    game_id: str
    move: str
    status: str
    current_turn: str
    fen: str
