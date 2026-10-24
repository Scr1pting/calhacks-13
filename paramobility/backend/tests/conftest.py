from datetime import UTC, datetime, timedelta

import pytest

from app.core import config
from app.core.schemas import Contact, Rider, Trip, TripRequest
from app.core.store import Store, set_store


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    """Fake model, no real calls, and a webhook secret for the voice API tests."""
    for key in ("CARTESIA_API_KEY", "CARTESIA_FROM_NUMBER_ID", "API_KEY"):
        monkeypatch.setenv(key, "")
    monkeypatch.setenv("MODEL_BACKEND", "fake")
    monkeypatch.setenv("VOICE_WEBHOOK_SECRET", "test-secret")
    config.get_settings.cache_clear()
    yield config.get_settings()
    config.get_settings.cache_clear()


@pytest.fixture(autouse=True)
def store():
    s = Store(":memory:")
    set_store(s)
    return s


@pytest.fixture
def arrive_by():
    return datetime(2026, 11, 3, 14, 0, tzinfo=UTC)


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
