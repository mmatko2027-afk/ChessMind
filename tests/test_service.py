
from app.service import ChessService
from app.storage import ChessStorage


def setup_test_database(service, tmp_path):

    storage = ChessStorage(
        str(tmp_path / "test_service.db")
    )

    storage.initialize()

    service.orchestrator.gateway.storage = storage


def test_explain_position(tmp_path):

    service = ChessService()

    setup_test_database(service, tmp_path)

    result = service.explain_position(
        question="Як ходить кінь?",
        position="current",
        request_id="service-test-1"
    )

    assert result.answer
    assert result.suggestion
    assert result.request_id == "service-test-1"
    assert result.has_enough_data is True


def test_pawn_explanation(tmp_path):

    service = ChessService()

    setup_test_database(service, tmp_path)

    result = service.explain_position(
        question="Як ходить пішак?",
        position="current",
        request_id="service-test-2"
    )

    assert result.answer
    assert result.suggestion
    assert result.request_id == "service-test-2"
    assert result.has_enough_data is True
