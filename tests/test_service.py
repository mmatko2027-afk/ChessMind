
from app.service import ChessService


def test_explain_position():

    service = ChessService()

    result = service.explain_position(
        question="Як ходить кінь?",
        position="current",
        request_id="service-test-1"
    )

    assert result.answer
    assert result.suggestion
    assert result.request_id == "service-test-1"


def test_pawn_explanation():

    service = ChessService()

    result = service.explain_position(
        question="Як ходить пішак?",
        position="current",
        request_id="service-test-2"
    )

    assert "Пішак" in result.answer
    assert "діагоналі" in result.suggestion
    assert result.request_id == "service-test-2"
