
from fastapi.testclient import TestClient

from app.main import app, service
from app.storage import ChessStorage


def setup_test_database(gateway, tmp_path):

    storage = ChessStorage(
        str(tmp_path / "test_api.db")
    )

    storage.initialize()

    gateway.storage = storage


def test_health():

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "ok"
    assert data["provider"] == "mock"
    assert "version" in data
    assert "uptime_s" in data
    assert data["storage"] == "ok"


def test_coach_explain(tmp_path):

    setup_test_database(
        service.orchestrator.gateway,
        tmp_path
    )

    with TestClient(app) as client:

        response = client.post(
            "/api/coach/explain",
            json={
                "question": "Як ходить кінь?",
                "position": "Початкова позиція"
            }
        )

    assert response.status_code == 200

    data = response.json()

    assert data["answer"]
    assert data["suggestion"]
    assert data["request_id"]
    assert data["has_enough_data"] is True
    assert data["missing_information"] == []

    assert (
        data["request_id"]
        == response.headers["X-Request-ID"]
    )


def test_coach_insufficient_information(tmp_path):

    setup_test_database(
        service.orchestrator.gateway,
        tmp_path
    )

    with TestClient(app) as client:

        response = client.post(
            "/api/coach/explain",
            json={
                "question": "Так",
                "position": "Початкова позиція"
            }
        )

    assert response.status_code == 200

    data = response.json()

    assert data["has_enough_data"] is False
    assert len(data["missing_information"]) > 0
    assert data["answer"]


def test_coach_invalid_request():

    with TestClient(app) as client:

        response = client.post(
            "/api/coach/explain",
            json={
                "question": "",
                "position": "Початкова позиція"
            }
        )

    assert response.status_code == 422
