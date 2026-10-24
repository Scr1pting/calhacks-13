from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core import config
from app.core.schemas import Contact, Rider, Trip, TripRequest
from app.core.store import Store, set_store
from app.prediction import plan

DRIVE_MIN = 20.0
LA = ZoneInfo("America/Los_Angeles")


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    """No real calls, and a webhook secret for the voice API tests."""
    for key in (
        "CARTESIA_API_KEY",
        "CARTESIA_FROM_NUMBER_ID",
        "API_KEY",
        "GOOGLE_MAPS_KEY",
        "ORS_API_KEY",
    ):
        monkeypatch.setenv(key, "")
    monkeypatch.setenv("DEMO_CACHE", "false")
    monkeypatch.setenv("VOICE_WEBHOOK_SECRET", "test-secret")
    config.get_settings.cache_clear()
    yield config.get_settings()
    config.get_settings.cache_clear()


@pytest.fixture(autouse=True)
def drive(monkeypatch):
    """Every trip is a 20-min direct drive, so the model runs without routing calls."""
    monkeypatch.setattr(plan, "drive_minutes", lambda ride, depart: DRIVE_MIN)
    plan.tradeoff.cache_clear()
    yield
    plan.tradeoff.cache_clear()


@pytest.fixture(autouse=True)
def store():
    s = Store(":memory:")
    set_store(s)
    return s


@pytest.fixture
def arrive_by():
    return datetime(2026, 11, 3, 14, 0, tzinfo=LA)  # the model's clock runs on LA time


@pytest.fixture
def trip_request(arrive_by):
    return TripRequest(
        rider=Rider(name="Maya"),
        appointment=Contact(name="Eastside Clinic", phone="+14155550199"),
        origin="1200 Market St, San Francisco",
        dest="Eastside Clinic, Oakland",
        arrive_by=arrive_by,
        certainty=0.9,
    )


@pytest.fixture
def trip(store, trip_request):
    t = Trip(**trip_request.model_dump())
    store.put_trip(t)
    return t


def at(base: datetime, minutes: int) -> datetime:
    return base + timedelta(minutes=minutes)
