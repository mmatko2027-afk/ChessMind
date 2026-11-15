from app.storage import ChessStorage
from app.providers.errors import ProviderBudgetExceededError


def test_ai_request_limit(monkeypatch, tmp_path):
    test_db = tmp_path / "test_chessmind.db"
    storage = ChessStorage(str(test_db))

    monkeypatch.setattr(
        "app.settings.settings.daily_ai_request_limit",
        1
    )

    storage.initialize()
    storage.record_ai_request()
    storage.record_ai_request()

    try:
        storage.check_ai_limits()
        assert False, "Перевищено денний ліміт AI-запитів."

    except ProviderBudgetExceededError as error:
        assert error.kind == "budget_exceeded"

def test_ai_budget_limit(monkeypatch, tmp_path):
    test_db = tmp_path / "test_budget.db"
    storage = ChessStorage(str(test_db))

    monkeypatch.setattr(
        "app.settings.settings.daily_ai_budget",
        1.0
    )

    storage.initialize()
    storage.record_ai_usage(1.0)

    try:
        storage.check_ai_limits()
        assert False, "Перевищено денний бюджет AI-використання."

    except ProviderBudgetExceededError as error:
        assert error.kind == "budget_exceeded"