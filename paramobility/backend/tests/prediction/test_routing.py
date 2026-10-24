from datetime import datetime

import pytest

from app.core.config import get_settings
from app.prediction import routing

NOW = datetime(2026, 10, 24, 12, 0, tzinfo=routing.TZ)  # a Saturday


def test_departure_rounds_and_rolls_forward():
    assert routing.departure(datetime(2026, 10, 27, 13, 8), NOW) == datetime(
        2026, 10, 27, 13, 15, tzinfo=routing.TZ
    )
    # past -> same weekday and time next week
    assert routing.departure(datetime(2026, 10, 20, 9, 0), NOW) == datetime(
        2026, 10, 27, 9, 0, tzinfo=routing.TZ
    )
    assert routing.departure(datetime(2026, 10, 24, 23, 55), NOW) == datetime(
        2026, 10, 25, 0, 0, tzinfo=routing.TZ
    )


def test_cache(monkeypatch, tmp_path):
    calls = []

    def fake_google(origin, destination, t):
        calls.append(t)
        return 20.0 + len(calls)

    monkeypatch.setenv("DRIVE_CACHE_PATH", str(tmp_path / "cache.json"))
    monkeypatch.setattr(routing, "_google", fake_google)
    monkeypatch.setenv("GOOGLE_MAPS_KEY", "test")
    get_settings.cache_clear()
    o, d = (37.67, -122.08), (37.80, -122.23)
    future = datetime(2027, 1, 5, 13, 10)
    assert routing.drive_minutes(o, d, future) == 21.0
    assert (
        routing.drive_minutes(o, d, datetime(2027, 1, 12, 13, 14)) == 21.0
    )  # same weekday + 15-min slot
    assert routing.drive_minutes(o, d, datetime(2027, 1, 5, 17, 0)) == 22.0  # different slot
    assert len(calls) == 2
    assert routing.drive_minutes(o, d, future, max_age_days=0) == 23.0  # expired


def test_no_key(monkeypatch):
    # blank, not unset: an unset key would be read from .env
    monkeypatch.setenv("GOOGLE_MAPS_KEY", "")
    monkeypatch.setenv("ORS_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="no routing key"):
        routing.drive_minutes((37.67, -122.08), (37.80, -122.23), datetime(2027, 1, 5, 13, 0))


def test_geocode_is_cached_by_normalized_address(monkeypatch, tmp_path):
    calls = []

    def fake_get(url, params):
        calls.append(params["address"])
        return {
            "status": "OK",
            "results": [{"geometry": {"location": {"lat": 37.8, "lng": -122.27}}}],
        }

    monkeypatch.setenv("DRIVE_CACHE_PATH", str(tmp_path / "cache.json"))
    monkeypatch.setattr(routing, "_get", fake_get)
    monkeypatch.setenv("GOOGLE_MAPS_KEY", "test")
    get_settings.cache_clear()
    assert routing.geocode("1 Main St, Oakland") == (37.8, -122.27)
    assert routing.geocode("  1 main st,   OAKLAND ") == (37.8, -122.27)
    assert calls == ["1 Main St, Oakland"]


def test_geocode_without_a_match(monkeypatch, tmp_path):
    monkeypatch.setenv("DRIVE_CACHE_PATH", str(tmp_path / "cache.json"))
    monkeypatch.setattr(routing, "_get", lambda url, params: {"status": "ZERO_RESULTS"})
    monkeypatch.setenv("GOOGLE_MAPS_KEY", "test")
    get_settings.cache_clear()
    with pytest.raises(routing.RoutingError, match="can't find"):
        routing.geocode("nowhere")
