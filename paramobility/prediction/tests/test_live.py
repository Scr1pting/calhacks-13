import math

import pytest
from fastapi.testclient import TestClient

import api
import live
import routing

DEST = (37.8, -122.2)
ORIGIN = (37.8, -122.2 - 12_000 / (111_320 * math.cos(math.radians(37.8))))
TRIP = {"appointment": "14:00", "window_start": "13:00", "destination": list(DEST), "drive_min": 25}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    live.TRIPS.clear()
    monkeypatch.setattr(routing, "drive_now", lambda o, d: routing.distance_m(o, d) / 500)  # 2 min/km
    yield
    live.TRIPS.clear()


@pytest.fixture
def client():
    with TestClient(api.app) as c:
        yield c


def put(client, trip_id="a", **changes):
    return client.put(f"/trips/{trip_id}", json={**TRIP, **changes})


def event(client, trip_id="a", **body):
    return client.post(f"/trips/{trip_id}/events", json=body)


def east_of(p, meters):
    return p[0], p[1] + meters / (111_320 * math.cos(math.radians(p[0])))


def test_lifecycle(client):
    assert put(client, origin=list(ORIGIN)).status_code == 200
    assert event(client, type="refresh", t="12:40:00").json()["phase"] == "scheduled"
    waiting = event(client, type="refresh", t="13:20:00").json()
    assert waiting["phase"] == "waiting"
    later = client.get("/trips/a/status").json()  # same clock: last event time
    assert later == waiting
    out = event(client, type="picked_up", lat=ORIGIN[0], lng=ORIGIN[1], t="13:25:00").json()
    assert out["phase"] == "onboard" and out["progress"] == 0.0 and not out["stale"]
    p = east_of(ORIGIN, 6000)
    out = event(client, type="gps", lat=p[0], lng=p[1], t="13:37:00").json()
    assert out["progress"] == pytest.approx(0.5, abs=0.01)
    out = event(client, type="arrived", t="13:52:00").json()
    assert out["phase"] == "arrived" and out["eta"] == "13:52" and out["p_on_time"] == 1.0
    rec = out["record"]
    assert rec["pickup_lateness_min"] == 25.0 and rec["ride_min"] == 27.0 and rec["drive_at_pickup"] == 24.0
    assert not out["sharing"]
    trip = live.get("a")
    assert trip.state.last_pos is None and trip.state.last_call_pos is None  # raw GPS dropped
    assert event(client, type="gps", lat=DEST[0], lng=DEST[1], t="13:53:00").status_code == 409


def test_unknown_trip_is_404(client):
    assert event(client, "nope", type="gps", lat=1, lng=2).status_code == 404
    assert client.get("/trips/nope/status").status_code == 404


def test_gps_before_pickup_is_409(client):
    put(client)  # no origin: no auto-pickup detection
    assert event(client, type="gps", lat=DEST[0], lng=DEST[1], t="12:50:00").status_code == 409
    assert event(client, type="gps", lat=DEST[0], lng=DEST[1], t="13:10:00").status_code == 409
    assert event(client, type="arrived", t="13:10:00").status_code == 409


@pytest.mark.parametrize(("body", "code"), [
    ({"type": "gps", "t": "13:30:00"}, 422),  # no position
    ({"type": "gps", "lat": 37.8, "lng": -122.2, "t": "25:00:00"}, 422),
    ({"type": "teleport"}, 422),
])
def test_bad_events_are_422(client, body, code):
    put(client)
    event(client, type="picked_up", t="13:10:00")
    assert event(client, **body).status_code == code


def test_inaccurate_fix_is_ignored(client):
    put(client)
    event(client, type="picked_up", lat=ORIGIN[0], lng=ORIGIN[1], t="13:10:00")
    p = east_of(ORIGIN, 6000)
    before = live.get("a").state.last_pos
    r = event(client, type="gps", lat=p[0], lng=p[1], t="13:20:00", accuracy=250)
    assert r.status_code == 200 and live.get("a").state.last_pos == before


def test_auto_pickup_detection_asks(client):
    put(client, origin=list(ORIGIN))
    for k, t in enumerate(("13:10:00", "13:10:20", "13:10:40", "13:11:00", "13:11:20")):
        p = east_of(ORIGIN, 100 * k)  # 18 km/h
        out = event(client, type="gps", lat=p[0], lng=p[1], t=t).json()
    assert out["phase"] == "waiting" and out["ask_picked_up"]


def test_arrival_detected_after_a_minute_near_destination(client):
    put(client)
    event(client, type="picked_up", lat=ORIGIN[0], lng=ORIGIN[1], t="13:10:00")
    near = east_of(DEST, -50)
    assert event(client, type="gps", lat=near[0], lng=near[1], t="13:40:00").json()["phase"] == "onboard"
    out = event(client, type="gps", lat=DEST[0], lng=DEST[1], t="13:41:05").json()
    assert out["phase"] == "arrived" and out["eta"] == "13:40"


def test_stop_sharing_freezes(client):
    put(client)
    event(client, type="picked_up", lat=ORIGIN[0], lng=ORIGIN[1], t="13:10:00")
    out = event(client, type="stop_sharing", t="13:12:00").json()
    assert out["phase"] == "onboard" and out["stale"] and not out["sharing"]
    assert live.get("a").state.last_pos is None
    assert event(client, type="gps", lat=DEST[0], lng=DEST[1], t="13:13:00").status_code == 409


def test_gps_dropped_after_3_hours(client):
    put(client)
    event(client, type="picked_up", lat=ORIGIN[0], lng=ORIGIN[1], t="10:00:00")
    out = event(client, type="refresh", t="13:01:00").json()
    assert out["stale"] and not out["sharing"] and live.get("a").state.last_pos is None


def test_status_also_drops_gps_after_3_hours(client):
    put(client)
    event(client, type="picked_up", lat=ORIGIN[0], lng=ORIGIN[1], t="10:00:00")
    live.get("a").clock = 13 * 60 + 1  # the phone went silent; only reads happen
    assert client.get("/trips/a/status").json()["stale"] and live.get("a").state.last_pos is None


def test_routing_error_is_stale_not_error(client, monkeypatch):
    put(client)
    event(client, type="picked_up", lat=ORIGIN[0], lng=ORIGIN[1], t="13:10:00")

    def broken(o, d):
        raise routing.RoutingError("boom")

    monkeypatch.setattr(routing, "drive_now", broken)
    p = east_of(ORIGIN, 1000)
    r = event(client, type="gps", lat=p[0], lng=p[1], t="13:13:00")
    assert r.status_code == 200 and r.json()["stale"]


def test_stream_pushes_on_eta_change(client):
    put(client, drive_min=40)  # planned 40-min drive; the live drive is much shorter
    event(client, type="picked_up", t="13:10:00")  # no position: fallback estimate from the plan
    with client.websocket_connect("/trips/a/stream") as ws:
        first = ws.receive_json()
        assert first["phase"] == "onboard"
        near = east_of(DEST, -2000)
        event(client, type="gps", lat=near[0], lng=near[1], t="13:11:00")
        pushed = ws.receive_json()
        assert pushed["eta"] != first["eta"]


def test_stream_unknown_trip(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/trips/nope/stream") as ws:
        ws.receive_json()


def test_replay_endpoint_with_given_track(client, monkeypatch):
    import sim

    started = []
    monkeypatch.setattr(sim, "start_replay", lambda *a: started.append(a))
    put(client)
    track = [[*ORIGIN, "13:10:00"], [*east_of(ORIGIN, 500), "13:11:00"]]
    r = client.post("/sim/replay", json={"trip_id": "a", "track": track, "speed": 20})
    assert r.status_code == 200 and r.json()["seconds"] == 3.0 and started
    assert client.post("/sim/replay", json={"trip_id": "nope", "track": track}).status_code == 404
    assert client.post("/sim/replay", json={"trip_id": "a"}).status_code == 422  # no origin, no track
