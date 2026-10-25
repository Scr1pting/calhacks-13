import asyncio
import datetime
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
    info = client.get("/presentation").json()
    assert info["trip_id"] == trip["id"]
    # What the dashboard's film says about the ride.
    assert {"rider", "title", "appointment_name", "dest"} <= info.keys()
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


def test_the_trip_shows_where_the_ride_is_only_once_she_is_aboard(client, store):
    trip_id = start(client)["id"]
    clock(client, PICKUP - 5)
    waiting = store.get_trip(trip_id).live
    assert waiting.position is None  # nobody knows where the van is
    assert waiting.origin == ORIGIN and waiting.destination == DEST
    clock(client, 650)
    riding = store.get_trip(trip_id).live
    assert riding.position is not None and ORIGIN[0] < riding.position[0] < DEST[0]


def test_a_moved_appointment_moves_the_chance_and_going_back_restores_it(client, store):
    trip_id = start(client)["id"]
    clock(client, 650)
    before = store.get_trip(trip_id)
    later = before.arrive_by + datetime.timedelta(minutes=45)  # the clinic offered a new time
    store.update_trip(trip_id, lambda t: setattr(t, "arrive_by", later))
    clock(client, 652)
    assert store.get_trip(trip_id).outlook.p_on_time > before.outlook.p_on_time
    clock(client, PICKUP - 5)  # back in time: the appointment as booked
    assert store.get_trip(trip_id).arrive_by == before.arrive_by


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


def test_a_new_time_from_the_call_moves_the_trip_and_its_chance_at_once(client, store, monkeypatch):
    async def fake_call(trip_id, a):
        return {
            "reached_someone": True,
            "acknowledged": True,
            "appointment_held": False,
            "new_time": "11:30",
        }  # the fixture's appointment is 10:45

    monkeypatch.setattr(monitor.actions, "call_about_delay", fake_call)
    trip_id = start(client, phone="+14155550199")["id"]
    clock(client, STAND_UNTIL)
    before = store.get_trip(trip_id)
    client.post(f"/trips/{trip_id}/late-ask", json={"call": True})
    eventually(lambda: store.get_trip(trip_id).late_notice is not None)
    eventually(lambda: store.get_trip(trip_id).outlook is not None)
    after = store.get_trip(trip_id)  # no clock post since: the server worked it out itself
    assert (after.arrive_by - before.arrive_by).total_seconds() == 45 * 60
    assert after.outlook.p_on_time > before.outlook.p_on_time
    assert any(e.kind == "appointment_moved" for e in store.events(trip_id))
    assert "moved your appointment to 11:30 AM" in store.messages("rider_1")[-1].text


def test_a_new_start_retires_the_last_trip(client, store):
    first = start(client)["id"]
    second = start(client)["id"]
    assert store.get_trip(first).status == TripStatus.completed
    assert store.get_trip(second).status == TripStatus.booked
    assert clock(client, PICKUP + 1)["trip_id"] == second


def test_clock_needs_a_started_ride(client):
    assert client.post("/presentation/clock", json={"t": 600}).status_code == 409


def test_the_timeline_matches_the_ride_the_clock_plays(client, store, monkeypatch):
    monkeypatch.setattr(presentation, "_timelines", {})
    points = client.get("/presentation/timeline").json()
    asks = [p for p in points if p["ask"]]
    assert len(asks) == 1 and asks[0]["ask_minutes"] >= 5  # asked once, as the trip is

    trip_id = start(client)["id"]
    before = [p for p in points if p["t"] < asks[0]["t"]][-1]
    out = clock(client, before["t"])
    assert out["status"]["p_on_time"] == before["p_on_time"]
    assert store.get_trip(trip_id).late_ask is None
    clock(client, asks[0]["t"])
    assert store.get_trip(trip_id).late_ask is not None
    assert points[-1]["phase"] == "arrived" and points[-1]["eta_low"] <= points[-1]["eta_high"]
