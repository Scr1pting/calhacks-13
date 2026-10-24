import datetime

import pytest
from fastapi.testclient import TestClient

import api
import routing

client = TestClient(api.app)
EXAMPLE = {"appointment": "14:00", "window_start": "13:00", "drive_min": 25,
           "history": [{"window_start": "13:00", "lateness_min": 18, "days_ago": 7},
                       {"window_start": "13:00", "lateness_min": 25, "days_ago": 14}]}


def post(**changes):
    body = {k: v for k, v in {**EXAMPLE, **changes}.items() if v is not None}
    return client.post("/advice/evaluate-window", json=body)


def test_drive_min_given():
    r = post()
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["window"] == "13:00–13:30"
    assert out["drive_source"] == "given" and out["drive_min"] == 25.0
    assert 0 <= out["p_very_early"] <= out["p_on_time"] <= 1
    q = out["arrival_vs_appointment"]
    assert set(q) == {"0.1", "0.5", "0.9"} and q["0.1"] < q["0.5"] < q["0.9"]
    assert out["latest_window_start"] < "13:00"
    assert "Your past pickups ran late" in out["drivers"]
    assert 1 <= len(out["drivers"]) <= 3


@pytest.mark.parametrize("changes", [
    {"window_start": "14:00"},
    {"window_start": "14:30"},
    {"window_start": "03:00", "appointment": "04:00"},
    {"history": [{"window_start": "03:00", "lateness_min": 5, "days_ago": 1}]},
    {"drive_min": None},  # neither
    {"origin": [37.67, -122.08], "destination": [37.80, -122.23]},  # both
    {"drive_min": None, "origin": [37.67, -122.08]},  # half the coordinates
    {"appointment": "25:00"},
    {"target": 1.0},
])
def test_invalid_is_422(changes):
    assert post(**changes).status_code == 422


def test_coordinates_use_routing(monkeypatch):
    calls = []

    def fake_drive_minutes(origin, destination, depart):
        calls.append((origin, destination, depart))
        return 30.0

    monkeypatch.setenv("GOOGLE_MAPS_KEY", "test")
    monkeypatch.setattr(routing, "drive_minutes", fake_drive_minutes)
    r = post(drive_min=None, origin=[37.67, -122.08], destination=[37.80, -122.23], date="2026-11-03")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["drive_source"] == "google" and out["drive_min"] == 30.0
    assert any("traffic-aware" in d for d in out["drivers"]) or len(out["drivers"]) == 3
    assert calls == [((37.67, -122.08), (37.80, -122.23), datetime.datetime(2026, 11, 3, 13, 15))]


def test_routing_failure_is_502(monkeypatch):
    def broken(*args):
        raise routing.RoutingError("boom")

    monkeypatch.setenv("GOOGLE_MAPS_KEY", "test")
    monkeypatch.setattr(routing, "drive_minutes", broken)
    assert post(drive_min=None, origin=[37.67, -122.08], destination=[37.80, -122.23]).status_code == 502


def test_no_routing_key_is_502(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_KEY", raising=False)
    monkeypatch.delenv("ORS_API_KEY", raising=False)
    assert post(drive_min=None, origin=[37.67, -122.08], destination=[37.80, -122.23]).status_code == 502


def test_recurring_trip_key():
    history = [{"window_start": "13:00", "lateness_min": 28, "days_ago": d, "trip_key": "dialysis"}
               for d in (7, 14, 21)]
    same = post(history=history, trip_key="dialysis").json()
    other = post(history=history, trip_key="dentist").json()
    assert same["p_on_time"] < other["p_on_time"] < post(history=[]).json()["p_on_time"]
    assert "This trip's past pickups ran late" in same["drivers"]
