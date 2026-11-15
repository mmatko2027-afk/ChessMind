
from fastapi.testclient import TestClient

from app.main import app


def test_health():

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "ok"
    assert data["provider"] == "mock"
    assert "version" in data
    assert "uptime_s" in data


def test_coach_explain():

    with TestClient(app) as client:

        response = client.post(
            "/api/coach/explain",
            json={
                "question": "Як ходить кінь?",
                "position": "current"
            }
        )

    assert response.status_code == 200

    data = response.json()

    assert data["answer"]
    assert data["suggestion"]
    assert data["request_id"]

    assert (
        data["request_id"]
        == response.headers["X-Request-ID"]
    )
