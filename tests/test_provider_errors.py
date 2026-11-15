
import tempfile

from fastapi.testclient import TestClient

from app.main import app, service
from app.models import ProviderRequest
from app.providers.mock import MockAIProvider
from app.providers.errors import ProviderUnavailableError


def setup_test_database(monkeypatch):

    db_file = tempfile.NamedTemporaryFile(
        suffix=".db",
        delete=False
    )

    db_file.close()

    storage = service.orchestrator.gateway.storage

    monkeypatch.setattr(
        storage,
        "db_path",
        db_file.name
    )

    storage.initialize()


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

    setup_test_database(monkeypatch)

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


def test_api_provider_timeout(monkeypatch):

    setup_test_database(monkeypatch)

    monkeypatch.setattr(
        "app.providers.mock.settings.mock_failure_mode",
        "timeout"
    )

    with TestClient(app) as client:

        response = client.post(
            "/api/coach/explain",
            json={
                "question": "Як ходить кінь?",
                "position": "current"
            }
        )

    assert response.status_code == 504

    data = response.json()

    assert data["error"]["kind"] == "provider_timeout"
    assert data["error"]["retryable"] is True


def test_api_provider_rate_limit(monkeypatch):

    setup_test_database(monkeypatch)

    monkeypatch.setattr(
        "app.providers.mock.settings.mock_failure_mode",
        "rate_limit"
    )

    with TestClient(app) as client:

        response = client.post(
            "/api/coach/explain",
            json={
                "question": "Як ходить кінь?",
                "position": "current"
            }
        )

    assert response.status_code == 429

    data = response.json()

    assert data["error"]["kind"] == "rate_limit"
    assert data["error"]["retryable"] is True
