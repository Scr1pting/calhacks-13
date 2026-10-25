import pytest
from fastapi.testclient import TestClient

from app.api import demo
from app.core.schemas import TripStatus
from app.main import app

BODY = {
    "phone": "(415) 555-0123",
    "clinic": "Eden Medical Center",
    "appointment_time": "10:15 AM",
    "message": "Maria will be about 20 minutes late. Could you move her to 10:45?",
}


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def placed(monkeypatch):
    calls = []

    async def fake_run_voice_task(trip, kind, variables):
        calls.append((trip, kind, variables))

    monkeypatch.setattr(demo, "run_voice_task", fake_run_voice_task)
    return calls


def test_an_unapproved_number_is_refused(client, placed):
    assert client.post("/demo/calls", json=BODY).status_code == 403
    assert placed == []


def test_the_call_goes_out_on_a_trip_nothing_else_touches(
    client, placed, settings, monkeypatch, store
):
    monkeypatch.setattr(settings, "call_allowlist", "+14155550123")
    r = client.post("/demo/calls", json=BODY)
    assert r.status_code == 202
    trip = store.get_trip(r.json()["trip_id"])
    assert trip.status == TripStatus.completed and trip.rider_id == ""
    assert trip.appointment.phone == "+14155550123"
    _, kind, variables = placed[0]
    assert kind == "rider_message"
    assert variables["message"] == BODY["message"]
