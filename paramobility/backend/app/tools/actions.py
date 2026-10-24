"""Actions that reach people outside the app.

Every call goes through here so the rider's limits are enforced in code,
whatever the agent asks for.
"""

from datetime import datetime

from app.core.schemas import AppointmentPolicy, Trip, VoiceTaskKind
from app.core.store import get_store
from app.voice.calls import run_voice_task

from .model_tools import DelayAssessment


class NotAllowed(Exception):
    pass


def _clock(dt: datetime, like: datetime) -> str:
    """Wall-clock time of dt in the time zone of like, e.g. "9:05 AM"."""
    local = dt.astimezone(like.tzinfo) if like.tzinfo else dt
    return local.strftime("%I:%M %p").lstrip("0")


def rider_label(trip: Trip) -> str:
    return trip.rider.name if trip.permissions.share_rider_name else "your patient"


def _take_call(trip_id: str) -> Trip:
    """Check the rider allows calling and use up one call from their budget."""

    def change(t: Trip):
        if not t.permissions.may_call_appointment:
            raise NotAllowed("The rider has not allowed calling the appointment.")
        if t.calls_used >= t.permissions.max_calls:
            raise NotAllowed(f"The rider's limit of {t.permissions.max_calls} calls is used up.")
        t.calls_used += 1

    return get_store().update_trip(trip_id, change)


async def inquire_policy(trip_id: str, questions: str) -> AppointmentPolicy | None:
    trip = _take_call(trip_id)
    task = await run_voice_task(
        trip,
        VoiceTaskKind.policy_inquiry,
        {
            "rider_name": rider_label(trip),
            "appointment_name": trip.appointment.name,
            "appointment_time": _clock(trip.arrive_by, trip.arrive_by),
            "questions": questions,
        },
    )
    result = task.result or {}
    if not result.get("reached_someone", True) or result.get("grace_minutes") is None:
        return None
    policy = AppointmentPolicy(
        grace_minutes=result["grace_minutes"],
        can_reschedule=result.get("can_reschedule"),
        alternative_times=result.get("alternative_times") or "",
        notes=result.get("notes") or "",
        source="call",
    )
    get_store().update_trip(trip_id, lambda t: setattr(t, "policy", policy))
    return policy


async def call_about_delay(trip_id: str, a: DelayAssessment) -> dict | None:
    trip = _take_call(trip_id)
    tz = trip.arrive_by
    task = await run_voice_task(
        trip,
        VoiceTaskKind.late_notice,
        {
            "rider_name": rider_label(trip),
            "appointment_name": trip.appointment.name,
            "appointment_time": _clock(trip.arrive_by, tz),
            "expected_arrival": _clock(a.expected_arrival, tz),
            "minutes_late": a.minutes_late,
        },
    )
    return task.result
