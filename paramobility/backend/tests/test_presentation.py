import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app.agents import monitor
from app.core.schemas import RiderProfile, TripStatus
from app.demo import presentation
from app.main import app
from app.prediction import routing

ORIGIN, DEST = (37.80, -122.27), (37.85, -122.27)  # 5.6 km apart
PICKUP, STAND_UNTIL, ARRIVE = 620.0, 636.0, 660.0


def eventually(check, timeout=15):
    deadline = time.time() + timeout
    while not check():
        assert time.time() < deadline, "timed out waiting for background work"
        time.sleep(0.05)


def track() -> list[list[float]]:
    """Waiting from 9:55, picked up at 10:20, standing at a stop until 10:36, then driving."""
    out, t = [], 595.0
    while t <= ARRIVE + 2:
        k = min(max((t - STAND_UNTIL) / (ARRIVE - STAND_UNTIL), 0.0), 1.0)
        out.append([t, ORIGIN[0] + (DEST[0] - ORIGIN[0]) * k, ORIGIN[1]])
        t += 0.25
    return out


@pytest.fixture(autouse=True)
def ride(monkeypatch):
    r = presentation.Ride(
        sim_trip="D15T0000",
        rider="Denise",
        title="Cardiology",
        appointment_name="Alta Bates Summit",
        origin="Fruitvale, Oakland",
        dest="Alta Bates Summit Medical Center",
        origin_pos=ORIGIN,
        dest_pos=DEST,
        window_start=600.0,
        appointment=645.0,
        pickup_t=PICKUP,
        dropoff_t=ARRIVE,
        track=track(),
    )
    monkeypatch.setattr(presentation, "_ride", r)
    monkeypatch.setattr(presentation, "_run", None)
    monkeypatch.setattr(presentation, "planned_drive", lambda r: 12.0)
    # 30 km/h, so standing at the stop costs the rider time she doesn't have.
    monkeypatch.setattr(routing, "drive_now", lambda o, d: routing.distance_m(o, d) / 500)
    return r


@pytest.fixture
def client(store):
    store.put_rider(RiderProfile(id="rider_1", name="Denise Carter", home="1520 Grand Ave"))
    with TestClient(app) as c:
        yield c


def start(client, phone=""):
    r = client.post("/presentation/start", json={"rider_id": "rider_1", "appointment_phone": phone})
    assert r.status_code == 200
    return r.json()


def clock(client, t):
    r = client.post("/presentation/clock", json={"t": t})
    assert r.status_code == 200
    return r.json()


def test_start_books_a_demo_trip_the_monitor_leaves_alone(client, store):
    trip = start(client)
    assert trip["status"] == "booked" and trip["demo"] == "presentation"
    assert trip["rider"]["name"] == "Denise Carter"
    assert "T10:45:00" in trip["arrive_by"] and "T10:00:00" in trip["booked_pickup"]
    assert trip["outlook"]["p_on_time"] > 0.5
    assert client.get("/presentation").json()["trip_id"] == trip["id"]
    assert asyncio.run(monitor.check_trip(trip["id"])) is None


def test_the_ride_follows_the_clock_and_asks_once(client, store):
    trip_id = start(client)["id"]
    waiting = store.get_trip(trip_id).outlook.p_on_time
    clock(client, PICKUP - 1)
    assert store.get_trip(trip_id).outlook.p_on_time < waiting  # still no van

    clock(client, PICKUP + 1)
    trip = store.get_trip(trip_id)
    assert trip.status == TripStatus.riding
    assert trip.live.picked_up_at.hour * 60 + trip.live.picked_up_at.minute == PICKUP
    assert trip.late_ask is None

    clock(client, STAND_UNTIL)  # standing at the stop: the chance falls below the threshold
    trip = store.get_trip(trip_id)
    assert trip.outlook.p_on_time < presentation.ALERT_BELOW
    assert trip.late_ask is not None and trip.late_ask.minutes_late >= 5
    assert [e.kind for e in store.events(trip_id)].count("late_ask") == 1

    clock(client, ARRIVE + 2)
    trip = store.get_trip(trip_id)
    assert trip.status == TripStatus.completed and trip.live.progress == 1.0
    assert [e.kind for e in store.events(trip_id)].count("late_ask") == 1


def test_going_back_replays_from_the_start(client, store):
    trip_id = start(client)["id"]
    clock(client, STAND_UNTIL)
    store.update_trip(trip_id, lambda t: setattr(t, "calls_used", 2))
    clock(client, PICKUP - 5)
    trip = store.get_trip(trip_id)
    assert trip.status == TripStatus.booked
    assert trip.late_ask is None and trip.calls_used == 0 and trip.live.picked_up_at is None
    clock(client, STAND_UNTIL)
    assert store.get_trip(trip_id).late_ask is not None


def test_saying_yes_places_the_call(client, store, monkeypatch):
    calls = []

    async def fake_call(trip_id, a):
        calls.append(a)
        return {"reached_someone": True, "acknowledged": True, "appointment_held": True}

    monkeypatch.setattr(monitor.actions, "call_about_delay", fake_call)
    trip_id = start(client, phone="+14155550199")["id"]
    assert client.post(f"/trips/{trip_id}/late-ask", json={"call": True}).status_code == 409
    clock(client, STAND_UNTIL)

    r = client.post(f"/trips/{trip_id}/late-ask", json={"call": True})
    assert r.status_code == 200 and r.json()["late_ask"]["answer"] == "call"
    eventually(lambda: store.get_trip(trip_id).late_notice is not None)
    ask = store.get_trip(trip_id).late_ask
    assert calls[0].minutes_late == ask.minutes_late
    assert "hold your appointment" in store.messages("rider_1")[-1].text
    assert client.post(f"/trips/{trip_id}/late-ask", json={"call": True}).status_code == 409


def test_a_new_start_retires_the_last_trip(client, store):
    first = start(client)["id"]
    second = start(client)["id"]
    assert store.get_trip(first).status == TripStatus.completed
    assert store.get_trip(second).status == TripStatus.booked
    assert clock(client, PICKUP + 1)["trip_id"] == second


def test_clock_needs_a_started_ride(client):
    assert client.post("/presentation/clock", json={"t": 600}).status_code == 409
