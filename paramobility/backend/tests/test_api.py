import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.agents import monitor, planner
from app.core.schemas import TripStatus, VoiceTask, VoiceTaskKind
from app.main import app
from app.tools import trip_ops


async def fake_plan_trip(trip_id: str) -> None:
    """Stand-in for the Sonnet planner: picks the first option through the real tools."""
    tools = {t.name: t for t in planner.build_tools(trip_id)}
    trip = planner.get_store().get_trip(trip_id)
    opts = planner.model_tools.options(trip, trip.certainty)
    await tools["get_options"].func(certainty=trip.certainty)
    await tools["submit_plan"].func(
        pickup_time=opts[0].pickup_time.isoformat(), explanation="Leaves time for detours."
    )


def eventually(check, timeout=15):
    """Wait for background work (planner, monitor) on the app's loop, as a client would."""
    deadline = time.time() + timeout
    while not check():
        assert time.time() < deadline, "timed out waiting for background work"
        time.sleep(0.05)


def planned(client, trip_id):
    eventually(lambda: client.get(f"/trips/{trip_id}").json()["status"] != "planning")
    return client.get(f"/trips/{trip_id}").json()


@pytest.fixture
def notified(monkeypatch):
    calls = []

    async def fake_notify(trip, a):
        calls.append(a)

    monkeypatch.setattr(planner, "plan_trip", fake_plan_trip)
    monkeypatch.setattr(monitor, "notify", fake_notify)
    return calls


@pytest.fixture
def client(notified):
    with TestClient(app) as c:
        yield c


def test_plan_book_and_ride(client, trip_request, notified, store):
    r = client.post("/trips", json=trip_request.model_dump(mode="json"))
    assert r.status_code == 202
    trip_id = r.json()["id"]

    trip = planned(client, trip_id)
    assert trip["status"] == "planned"
    pickup = trip["plan"]["recommended"]["pickup_time"]
    assert trip["plan"]["recommended"]["p_on_time"] >= 0.9

    r = client.post(f"/trips/{trip_id}/book", json={"pickup_time": pickup})
    assert r.json()["status"] == "booked"

    # The van shows up an hour late: the monitor should decide to notify.
    booked = store.get_trip(trip_id).booked_pickup
    r = client.post(f"/trips/{trip_id}/status",
                    json={"kind": "picked_up", "at": (booked + timedelta(hours=1)).isoformat()})
    assert r.json()["status"] == "riding"
    eventually(lambda: notified)
    assert notified[0].minutes_late > 0
    assert store.get_trip(trip_id).outlook.p_on_time < 0.5

    r = client.post(f"/trips/{trip_id}/status",
                    json={"kind": "arrived", "at": (booked + timedelta(hours=2)).isoformat()})
    assert r.json()["status"] == "completed"
    assert client.get("/calibration").json()

    notices = [m["text"] for m in client.get(f"/trips/{trip_id}/messages").json()]
    assert notices[0].startswith("Your plan is ready: pickup window")

    kinds = [e["kind"] for e in client.get(f"/trips/{trip_id}/events").json()]
    assert kinds[:3] == ["plan_ready", "booked", "picked_up"]


def test_booking_requires_a_scored_time(client, trip_request):
    trip_id = client.post("/trips", json=trip_request.model_dump(mode="json")).json()["id"]
    planned(client, trip_id)
    r = client.post(f"/trips/{trip_id}/book", json={"pickup_time": "2026-11-03T09:07:00Z"})
    assert r.status_code == 422


def test_api_key_is_checked_when_set(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "k")
    assert client.get("/trips").status_code == 401
    assert client.get("/trips", headers={"X-API-Key": "k"}).status_code == 200


def test_voice_webhook_saves_result(client, trip, store):
    task = VoiceTask(trip_id=trip.id, kind=VoiceTaskKind.policy_inquiry)
    store.put_voice_task(task)
    body = {"task_id": task.id, "reached_someone": True, "grace_minutes": 10}

    assert client.post("/voice/webhooks/policy", json=body).status_code == 401
    r = client.post("/voice/webhooks/policy", json=body,
                    headers={"Authorization": "Bearer test-secret"})
    assert r.status_code == 200
    assert store.get_voice_task(task.id).result["grace_minutes"] == 10


def test_replan_only_when_not_in_progress(client, trip, store):
    store.update_trip(trip.id, lambda t: setattr(t, "status", TripStatus.booked))
    assert client.post(f"/trips/{trip.id}/plan", json={}).status_code == 409


async def test_booking_while_the_planner_finishes_is_not_a_failure(trip, store, monkeypatch):
    """The rider can book as soon as the plan is saved, before Claude's last sentence."""

    class Runner:
        async def until_done(self):
            await fake_plan_trip(trip.id)  # saves the plan through the real tools
            trip_ops.book(trip.id, store.get_trip(trip.id).plan.recommended.pickup_time)
            return type("Message", (), {"content": []})()

    class Client:
        class beta:
            class messages:
                @staticmethod
                def tool_runner(**kwargs):
                    return Runner()

    monkeypatch.setattr(planner, "get_client", lambda: Client)
    await planner.plan_trip(trip.id)
    assert store.get_trip(trip.id).status == TripStatus.booked
