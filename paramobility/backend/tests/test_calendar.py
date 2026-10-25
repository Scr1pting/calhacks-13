from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.agents import calendar_check
from app.agents.calendar_check import Verdict
from app.core.schemas import RiderProfile, now
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def rider(store):
    profile = RiderProfile(id="rider_1", name="Denise", home="1520 Grand Ave, Oakland")
    store.put_rider(profile)
    return profile


@pytest.fixture
def haiku(monkeypatch):
    """Stands in for Haiku: anything at a clinic needs a ride. Records what it was asked."""
    asked = []

    class Messages:
        @staticmethod
        async def parse(**kwargs):
            text = kwargs["messages"][0]["content"]
            asked.append(text)
            clinic = "Kaiser" in text
            verdict = Verdict(
                needs_ride=clinic, reason="",
                title="Neurology" if clinic else "",
                place_name="Kaiser Oakland" if clinic else "",
                place_address="3600 Broadway, Oakland" if clinic else "",
                place_phone="",
            )
            return type("Response", (), {"stop_reason": "end_turn", "parsed_output": verdict})()

    class Client:
        messages = Messages

    monkeypatch.setattr(calendar_check, "get_client", lambda: Client)
    return asked


def entry(id, title, days, location=""):
    return {"id": id, "title": title, "start": (now() + timedelta(days=days)).isoformat(),
            "location": location}


def test_sync_keeps_only_entries_that_need_a_ride(client, rider, haiku, store):
    entries = [
        entry("e1", "Dr. Patel neuro f/u", 2, "Kaiser Permanente, 3600 Broadway"),
        entry("e2", "Team stand-up", 1, "https://zoom.us/j/1"),
        entry("e3", "Call with Mom", 3),
        entry("e4", "Old checkup", -2, "Kaiser"),  # past: never asked about
        entry("e5", "Kaiser follow-up", 30, "Kaiser"),  # beyond two weeks
    ]
    r = client.put(f"/riders/{rider.id}/calendar", json={"entries": entries})
    assert r.status_code == 200
    body = r.json()
    assert [e["id"] for e in body["calendar"]] == ["e1"]
    assert body["calendar"][0]["title"] == "Neurology"
    assert body["calendar"][0]["place_address"] == "3600 Broadway, Oakland"
    assert body["skipped"] == 2
    assert len(haiku) == 3
    assert [e.id for e in store.get_rider(rider.id).calendar] == ["e1"]


def test_unchanged_entries_are_not_asked_about_again(client, rider, haiku):
    entries = [entry("e1", "Neurology", 2, "Kaiser Oakland")]
    client.put(f"/riders/{rider.id}/calendar", json={"entries": entries})
    client.put(f"/riders/{rider.id}/calendar", json={"entries": entries})
    assert len(haiku) == 1
    entries[0]["title"] = "Neurology (moved)"
    client.put(f"/riders/{rider.id}/calendar", json={"entries": entries})
    assert len(haiku) == 2


def test_profile_sync_keeps_the_checked_calendar(client, rider, haiku):
    client.put(f"/riders/{rider.id}/calendar",
               json={"entries": [entry("e1", "Neurology", 2, "Kaiser Oakland")]})
    r = client.put(f"/riders/{rider.id}", json={"name": "Denise", "home": rider.home})
    assert [e["id"] for e in r.json()["calendar"]] == ["e1"]


def test_unknown_rider(client, haiku):
    assert client.put("/riders/nobody/calendar", json={"entries": []}).status_code == 404


def test_times_are_in_the_riders_zone(client, rider, haiku, store):
    store.update_rider(rider.id, lambda r: setattr(r, "time_zone", "America/Los_Angeles"))
    start = (now() + timedelta(days=2)).replace(hour=19, minute=0, second=0, microsecond=0)
    entries = [{"id": "e1", "title": "Knee surgery", "start": start.isoformat(),
                "location": "Kaiser Oakland"}]
    body = client.put(f"/riders/{rider.id}/calendar", json={"entries": entries}).json()
    kept = datetime.fromisoformat(body["calendar"][0]["start"])
    assert kept == start
    assert kept.utcoffset() == ZoneInfo("America/Los_Angeles").utcoffset(start.replace(tzinfo=None))
