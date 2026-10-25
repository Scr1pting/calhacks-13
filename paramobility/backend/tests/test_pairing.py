import pytest
from fastapi.testclient import TestClient

from app.api import pairing
from app.core.config import get_settings
from app.main import app


@pytest.fixture
def client(store, monkeypatch):
    monkeypatch.setattr(pairing, "_wrong", [])
    with TestClient(app) as c:
        yield c


def test_a_code_pairs_a_phone_as_the_rider(client):
    code = client.post("/pairing", json={"rider_id": "rider_stage_1"}).json()["code"]
    assert len(code) == 6 and code.isdigit()
    got = client.post(f"/pairing/{code}").json()
    assert got == {"rider_id": "rider_stage_1", "api_key": get_settings().api_key}


def test_wrong_and_old_codes_are_refused_and_guessing_stops(client, monkeypatch):
    code = client.post("/pairing", json={"rider_id": "rider_stage_1"}).json()["code"]
    assert client.post("/pairing/12345").status_code == 404
    monkeypatch.setattr(pairing.time, "time", lambda: 10**12)  # long after: expired
    assert client.post(f"/pairing/{code}").status_code == 404
    for _ in range(pairing.GUESSES):
        client.post("/pairing/000000")
    assert client.post("/pairing/000000").status_code == 429
