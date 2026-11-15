
from fastapi.testclient import TestClient

from app.main import app
from app.models import ProviderRequest
from app.providers.mock import MockAIProvider
from app.providers.errors import ProviderUnavailableError


def test_mock_provider_failure(monkeypatch):

    monkeypatch.setattr(
        "app.providers.mock.settings.mock_failure_mode",
        "unavailable"
    )

    provider = MockAIProvider()

    request = ProviderRequest(
        question="Як ходить кінь?",
        position="current",
        request_id="test-request-1"
    )

    try:
        provider.explain(request)
        assert False, "Expected ProviderUnavailableError"

    except ProviderUnavailableError:
        assert True


def test_api_provider_error(monkeypatch):

    monkeypatch.setattr(
        "app.providers.mock.settings.mock_failure_mode",
        "unavailable"
    )

    with TestClient(app) as client:

        response = client.post(
            "/api/coach/explain",
            json={
                "question": "Як ходить кінь?",
                "position": "current"
            }
        )

    assert response.status_code == 503

    data = response.json()

    assert data["error"]["kind"] == "provider_unavailable"
    assert data["error"]["retryable"] is True

    assert (
        data["error"]["request_id"]
        == response.headers["X-Request-ID"]
    )
