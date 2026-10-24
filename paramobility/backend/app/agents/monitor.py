"""Watch booked trips and warn the appointment when the rider is running late.

Detecting lateness is plain code over the delay model's numbers. Only once a
trip crosses the threshold does the notifier agent (Sonnet) decide whether to
call the appointment, through a tool that enforces the rider's limits.
"""

import asyncio
import json
import logging

from anthropic import beta_async_tool

from app.core import prompts
from app.core.config import get_settings
from app.core.jobs import spawn
from app.core.llm import FALLBACK_BETA, final_text, get_client
from app.core.schemas import LateNotice, Outlook, Trip, TripStatus, now
from app.core.store import get_store
from app.tools import actions, model_tools
from app.tools.model_tools import DelayAssessment, ModelUnavailable

log = logging.getLogger(__name__)
ACTIVE = (TripStatus.booked, TripStatus.riding)
_locks: dict[str, asyncio.Lock] = {}


def needs_notice(trip: Trip, a: DelayAssessment) -> bool:
    s = get_settings()
    if a.p_on_time >= s.late_trigger_p or a.minutes_late <= 0:
        return False
    last = trip.late_notice
    return last is None or a.minutes_late >= last.minutes_late + s.renotify_minutes


async def check_trip(trip_id: str) -> DelayAssessment | None:
    """Refresh a trip's outlook and notify if it just became (more) late."""
    lock = _locks.setdefault(trip_id, asyncio.Lock())
    async with lock:
        store = get_store()
        trip = store.get_trip(trip_id)
        if trip is None or trip.status not in ACTIVE or trip.booked_pickup is None:
            return None
        try:
            a = model_tools.assess_delay(trip, now())
        except ModelUnavailable:
            log.warning("delay model unavailable, skipping check for %s", trip_id)
            return None
        outlook = Outlook(
            checked_at=now(),
            p_on_time=a.p_on_time,
            expected_arrival=a.expected_arrival,
            minutes_late=a.minutes_late,
        )
        trip = store.update_trip(trip_id, lambda t: setattr(t, "outlook", outlook))
        if needs_notice(trip, a):
            store.log(trip_id, "running_late", f"Running about {a.minutes_late} min late.",
                      p_on_time=a.p_on_time, expected_arrival=a.expected_arrival.isoformat())
            await notify(trip, a)
        return a


def build_tools(trip_id: str, a: DelayAssessment):
    @beta_async_tool
    async def call_appointment() -> str:
        """Phone the appointment to say the rider is running late.

        The voice agent gives the expected arrival and minutes late from the
        delay model, and asks whether the rider can still be seen. Takes a few
        minutes. Counts toward the rider's call limit.
        """
        try:
            outcome = await actions.call_about_delay(trip_id, a)
        except actions.NotAllowed as e:
            return f"Not allowed: {e}"
        return json.dumps(outcome) if outcome else "The call ended without a clear outcome."

    return [call_appointment]


async def notify(trip: Trip, a: DelayAssessment) -> None:
    store = get_store()
    situation = {
        "rider": trip.rider.name,
        "appointment": trip.appointment.name,
        "appointment_time": trip.arrive_by.isoformat(),
        "known_policy": trip.policy.model_dump() if trip.policy else None,
        "delay_model": {
            "p_arrive_within_grace": a.p_on_time,
            "expected_arrival": a.expected_arrival.isoformat(),
            "minutes_late": a.minutes_late,
        },
        "previous_notice": trip.late_notice.model_dump(mode="json") if trip.late_notice else None,
        "rider_allows": {
            "calling_the_appointment": trip.permissions.may_call_appointment,
            "calls_left": trip.permissions.max_calls - trip.calls_used,
        },
    }
    try:
        runner = get_client().beta.messages.tool_runner(
            model=get_settings().planner_model,
            max_tokens=16000,
            output_config={"effort": "medium"},
            betas=[FALLBACK_BETA],
            fallbacks="default",
            system=prompts.load("notifier"),
            tools=build_tools(trip.id, a),
            messages=[{"role": "user", "content": f"<situation>\n{json.dumps(situation, indent=2)}"
                       "\n</situation>"}],
        )
        summary = final_text(await runner.until_done())
    except Exception as e:  # still record the notice below so we don't retry every minute
        log.exception("notifier failed for %s", trip.id)
        summary = f"Notifier error: {e}"

    # Record the notice even if no call was made, so we don't retry every minute.
    notice = LateNotice(sent_at=now(), minutes_late=a.minutes_late)
    store.update_trip(trip.id, lambda t: setattr(t, "late_notice", notice))
    store.log(trip.id, "late_handled", summary or "Handled the delay.")


async def monitor_loop() -> None:
    interval = get_settings().monitor_interval_seconds
    while True:
        for trip in get_store().all_trips():
            lock = _locks.get(trip.id)
            # A trip whose notifier is still on a call is checked again next round.
            if trip.status in ACTIVE and not (lock and lock.locked()):
                spawn(check_trip(trip.id), name=f"check:{trip.id}")
        await asyncio.sleep(interval)
