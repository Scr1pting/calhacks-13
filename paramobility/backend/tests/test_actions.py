from datetime import timedelta

import pytest

from app.core.schemas import VoiceTask
from app.tools import actions
from app.tools.model_tools import DelayAssessment


@pytest.fixture
def late(arrive_by):
    return DelayAssessment(
        p_on_time=0.2,
        expected_arrival=arrive_by + timedelta(minutes=25),
        minutes_late=25,
        deadline=arrive_by,
    )


@pytest.fixture
def voice_calls(monkeypatch):
    """Capture calls instead of placing them."""
    placed = []

    async def fake_run_voice_task(trip, kind, variables):
        placed.append(variables)
        return VoiceTask(trip_id=trip.id, kind=kind, result={"acknowledged": True})

    monkeypatch.setattr(actions, "run_voice_task", fake_run_voice_task)
    return placed


async def test_late_call_carries_the_model_numbers(trip, store, late, voice_calls):
    assert await actions.call_about_delay(trip.id, late) == {"acknowledged": True}
    assert voice_calls[0]["minutes_late"] == 25
    assert voice_calls[0]["expected_arrival"] == "2:25 PM"
    assert store.get_trip(trip.id).calls_used == 1


async def test_rider_can_forbid_calls(trip, store, late, voice_calls):
    store.update_trip(trip.id, lambda t: setattr(t.permissions, "may_call_appointment", False))
    with pytest.raises(actions.NotAllowed):
        await actions.call_about_delay(trip.id, late)
    assert not voice_calls
    assert store.get_trip(trip.id).calls_used == 0


async def test_call_budget_is_enforced(trip, store, late, voice_calls):
    store.update_trip(trip.id, lambda t: setattr(t.permissions, "max_calls", 1))
    await actions.call_about_delay(trip.id, late)
    with pytest.raises(actions.NotAllowed):
        await actions.inquire_policy(trip.id, "")
    assert len(voice_calls) == 1


async def test_rider_name_is_withheld_when_asked(trip, store, late, voice_calls):
    store.update_trip(trip.id, lambda t: setattr(t.permissions, "share_rider_name", False))
    await actions.call_about_delay(trip.id, late)
    assert voice_calls[0]["rider_name"] == "your patient"
