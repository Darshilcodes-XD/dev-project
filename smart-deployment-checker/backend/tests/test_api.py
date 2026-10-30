from backend.app.db import get_db


def test_home_endpoint_returns_application_identity(client):
    response = client.get("/")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["name"] == "Smart Deployment Checker"


def test_health_endpoint_returns_healthy(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "healthy"}


def test_invalid_endpoint_returns_404(client):
    response = client.get("/this-endpoint-does-not-exist")
    assert response.status_code == 404
    assert response.get_json()["error"] == "The requested resource was not found."


def test_production_rollout_requires_explicit_confirmation(client):
    response = client.post("/api/deployments", json={
        "environment": "Production", "version": "1.0.0", "namespace": "default", "replicas": 2,
    })
    assert response.status_code == 409
    assert "explicit confirmation" in response.get_json()["error"]


def test_dashboard_uses_empty_persisted_state(client):
    response = client.get("/api/dashboard")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["deployments"]["total"] == 0
    assert payload["infrastructure"]["mode"] == "sandbox"
