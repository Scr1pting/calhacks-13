"""Chat agent (Haiku): the rider's direct line to Paramobility, by text or voice.

A conversation thread belongs to a rider (all their trips and calendar
appointments) or, for trips without a rider profile, to one trip. The agent
answers from the trips' state and the delay model, and acts on the rider's
requests through the same operations and limits as the API: it can schedule a
ride for a new appointment, replan, book, and phone an appointment. Heavy
planning goes to the Sonnet planner; calls run in the background and report
back into the thread through handle_update().
"""

import asyncio
import json
import logging
import re
from datetime import UTC, datetime, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from anthropic import beta_async_tool

from app.core import prompts
from app.core.config import get_settings
from app.core.jobs import spawn
from app.core.llm import final_text, get_client
from app.core.schemas import (
    AppointmentPolicy,
    ChatMessage,
    Contact,
    Rider,
    RiderProfile,
    Trip,
    TripRequest,
    TripStatus,
    now,
)
from app.core.store import get_store
from app.core.thread import post_notice, thread_of
from app.tools import actions, model_tools, trip_ops
from app.tools.model_tools import ModelUnavailable
from app.tools.trip_ops import TripOpError

log = logging.getLogger(__name__)
_locks: dict[str, asyncio.Lock] = {}


def thread_trips(thread_id: str) -> list[Trip]:
    store = get_store()
    if store.get_rider(thread_id):
        return store.rider_trips(thread_id)
    trip = store.get_trip(thread_id)
    return [trip] if trip else []


def thread_tz(thread_id: str) -> tzinfo:
    """The rider's time zone: from their profile, else from their appointments."""
    rider = get_store().get_rider(thread_id)
    if rider:
        try:
            return ZoneInfo(rider.time_zone)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    times = [e.start for e in (rider.calendar if rider else [])]
    times += [t.arrive_by for t in thread_trips(thread_id)]
    for t in times:
        if t.tzinfo:
            return t.tzinfo
    return UTC


def trip_state(trip: Trip) -> dict:
    p = trip.permissions
    plan = trip.plan
    return {
        "trip_id": trip.id,
        "status": trip.status,
        "appointment": trip.appointment.name,
        "appointment_for": trip.title,
        "arrive_by": trip.arrive_by.isoformat(),
        "origin": trip.origin,
        "destination": trip.dest,
        "certainty_wanted": trip.certainty,
        "known_policy": trip.policy.model_dump() if trip.policy else None,
        "plan": {
            "recommended": plan.recommended.model_dump(mode="json"),
            "options": [o.model_dump(mode="json") for o in plan.options],
            "explanation": plan.explanation,
        } if plan else None,
        "booked_pickup": trip.booked_pickup.isoformat() if trip.booked_pickup else None,
        "live": trip.live.model_dump(mode="json"),
        "outlook": trip.outlook.model_dump(mode="json") if trip.outlook else None,
        "rider_allows": {
            "calling_the_appointment": p.may_call_appointment,
            "sharing_rider_name": p.share_rider_name,
            "calls_left": p.max_calls - trip.calls_used,
        },
    }


def context(thread_id: str) -> dict:
    """What the agent sees at the start of each turn."""
    rider = get_store().get_rider(thread_id)
    trips = thread_trips(thread_id)
    current = now().astimezone(thread_tz(thread_id))
    upcoming = [t for t in trips if t.status != TripStatus.completed]
    done = [t for t in trips if t.status == TripStatus.completed]
    state = {
        "now": current.isoformat(),
        "rider": (
            {"name": rider.name, "home": rider.home} if rider else {"name": trips[0].rider.name}
        ),
        "trips": [trip_state(t) for t in upcoming],
        "last_completed_trip": trip_state(done[-1]) if done else None,
    }
    if rider:
        planned = {t.calendar_event_id for t in trips if t.calendar_event_id}
        state["calendar_appointments_without_a_ride"] = [
            e.model_dump(mode="json") for e in rider.calendar
            if e.id not in planned and e.start > current
        ]
    return state


def plain_text(text: str) -> str:
    """The app shows messages as plain text, so drop markdown the model adds anyway."""
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"^\s*#+\s*", "", text, flags=re.M)
    return re.sub(r"^\s*[-*]\s+", "", text, flags=re.M)


def _parse_time(value: str, tz: tzinfo) -> datetime:
    t = datetime.fromisoformat(value)
    return t if t.tzinfo else t.replace(tzinfo=tz)


def build_tools(thread_id: str):
    store = get_store()

    def trip(trip_id: str) -> Trip:
        """The trip, if it belongs to this conversation."""
        if trip_id not in {t.id for t in thread_trips(thread_id)}:
            raise TripOpError(
                404, f"no trip {trip_id!r} in this conversation; use a trip_id from <rider>"
            )
        return store.get_trip(trip_id)

    @beta_async_tool
    async def schedule_ride(
        title: str,
        arrive_by: str,
        place_name: str,
        place_address: str,
        place_phone: str = "",
        calendar_event_id: str = "",
        certainty: float = 0.9,
    ) -> str:
        """Plan a ride for an appointment: a new one the rider mentions, or one from their calendar.

        Only when the rider asks. The planner runs in the background (it may
        phone the appointment about its late policy) and posts the plan here.

        Args:
            title: What the appointment is for, e.g. "Dentist".
            arrive_by: The rider's local date and time, without a UTC offset, e.g.
                2026-10-30T15:00. Leeway applies their time zone.
            place_name: Where it is, e.g. "Kaiser Oakland".
            place_address: Street address of the place.
            place_phone: The place's phone number in E.164 (e.g. +15105550123), if
                the rider knows it. Without it, Leeway can't call them.
            calendar_event_id: The id from calendar_appointments_without_a_ride,
                when planning one of those.
            certainty: Chance of arriving on time to plan for, 0.5 to 0.99.
        """
        rider: RiderProfile | None = store.get_rider(thread_id)
        if rider is None:
            return "Error: scheduling new rides needs a rider profile."
        try:
            when = _parse_time(arrive_by, thread_tz(thread_id))
        except ValueError as e:
            return f"Error: {e}"
        if when <= now():
            return "Error: that time has already passed."
        may_call = rider.permissions.may_call_appointment and bool(place_phone)
        permissions = rider.permissions.model_copy(update={"may_call_appointment": may_call})
        t = trip_ops.create(TripRequest(
            rider=Rider(name=rider.name),
            appointment=Contact(name=place_name, phone=place_phone),
            title=title,
            rider_id=rider.id,
            calendar_event_id=calendar_event_id,
            origin=rider.home,
            dest=place_address,
            arrive_by=when,
            certainty=min(max(certainty, 0.5), 0.99),
            permissions=permissions,
        ))
        return f"Planning started for trip {t.id}. The plan will be posted in this conversation."

    @beta_async_tool
    async def get_options(trip_id: str, certainty: float) -> str:
        """Ask the delay model for the best pickup times at a given certainty.

        Use it for what-if questions such as "what if I want to be 95% sure?".
        It does not change the plan.

        Args:
            trip_id: The trip, from <rider>.
            certainty: Chance of arriving on time, between 0.5 and 0.99.
        """
        try:
            opts = await asyncio.to_thread(model_tools.options, trip(trip_id), certainty)
        except (ModelUnavailable, TripOpError) as e:
            return f"Error: {e}"
        if not opts:
            return "No pickup time reaches that certainty."
        return json.dumps([o.model_dump(mode="json") for o in opts])

    @beta_async_tool
    async def replan(trip_id: str, certainty: float | None = None) -> str:
        """Make a new plan, optionally at a different certainty. Only when the rider asks.

        The planner runs in the background (it may phone the appointment) and
        posts the new plan in this conversation when it's ready.

        Args:
            trip_id: The trip, from <rider>.
            certainty: New chance of arriving on time to plan for, 0.5 to 0.99; omit to keep it.
        """
        try:
            trip(trip_id)
            trip_ops.start_planning(trip_id, certainty)
        except TripOpError as e:
            return f"Error: {e}"
        return "Planning started. The new plan will be posted in this conversation."

    @beta_async_tool
    async def book_pickup(trip_id: str, pickup_time: str) -> str:
        """Record the pickup time the rider has chosen. Only when the rider clearly confirms.

        Args:
            trip_id: The trip, from <rider>.
            pickup_time: A pickup_time from the trip's plan, copied exactly.
        """
        try:
            t = trip_ops.book(trip_id, _parse_time(pickup_time, trip(trip_id).arrive_by.tzinfo))
        except (TripOpError, ValueError) as e:
            return f"Error: {e}"
        return f"Booked pickup at {t.booked_pickup.isoformat()}."

    @beta_async_tool
    async def save_known_policy(
        trip_id: str, grace_minutes: int, can_reschedule: bool | None = None, notes: str = ""
    ) -> str:
        """Save an appointment's late policy when the rider already knows it.

        Replan afterwards (if the rider wants) so the plan uses it.

        Args:
            trip_id: The trip, from <rider>.
            grace_minutes: Minutes after the appointment time the rider can still be seen.
            can_reschedule: Whether the appointment can be moved if the ride runs late.
            notes: Anything else the rider said about the policy.
        """
        try:
            trip(trip_id)
        except TripOpError as e:
            return f"Error: {e}"
        policy = AppointmentPolicy(
            grace_minutes=grace_minutes, can_reschedule=can_reschedule, notes=notes
        )
        trip_ops.set_policy(trip_id, policy)
        return "Policy saved."

    @beta_async_tool
    async def change_appointment_time(trip_id: str, new_time: str) -> str:
        """Update an appointment's time after it has actually been moved.

        Before pickup this starts a new plan (the old booking is cleared, so the
        rider must book again); during the ride it updates the arrival outlook.

        Args:
            trip_id: The trip, from <rider>.
            new_time: The new appointment time as ISO 8601, in the trip's time zone.
        """
        try:
            tz = trip(trip_id).arrive_by.tzinfo
            t = trip_ops.change_appointment_time(trip_id, _parse_time(new_time, tz))
        except (TripOpError, ValueError) as e:
            return f"Error: {e}"
        return f"Appointment time is now {t.arrive_by.isoformat()}; trip status {t.status}."

    @beta_async_tool
    async def update_permissions(
        trip_id: str,
        may_call_appointment: bool | None = None,
        share_rider_name: bool | None = None,
        max_calls: int | None = None,
    ) -> str:
        """Change what the agents may do for a trip. Only exactly as the rider asks.

        Args:
            trip_id: The trip, from <rider>.
            may_call_appointment: Whether agents may phone the appointment.
            share_rider_name: Whether calls may use the rider's name.
            max_calls: Most calls to the appointment for this trip, in total.
        """
        try:
            trip(trip_id)
        except TripOpError as e:
            return f"Error: {e}"
        t = trip_ops.update_permissions(
            trip_id,
            may_call_appointment=may_call_appointment,
            share_rider_name=share_rider_name,
            max_calls=max_calls,
        )
        return f"Permissions now: {t.permissions.model_dump_json()}"

    @beta_async_tool
    async def message_appointment(trip_id: str, message: str) -> str:
        """Phone an appointment and pass on a message from the rider.

        Only when the rider asks for it. Write the message as the rider wants it
        said, e.g. "Maya would like to take the 3:30 PM slot you offered." The
        call runs in the background and its outcome is posted in this
        conversation. Counts toward the trip's call limit.

        Args:
            trip_id: The trip, from <rider>.
            message: What to tell the appointment, in one or two sentences.
        """
        try:
            t = trip(trip_id)
        except TripOpError as e:
            return f"Error: {e}"
        if not t.permissions.may_call_appointment:
            return "Not allowed: calls to this appointment are off, or Leeway has no number."
        if t.calls_used >= t.permissions.max_calls:
            return f"Not allowed: the rider's limit of {t.permissions.max_calls} calls is used up."
        spawn(_relay(trip_id, message), name=f"relay:{trip_id}")
        return "Call started. The outcome will be posted in this conversation."

    tools = [
        get_options, replan, book_pickup, save_known_policy,
        change_appointment_time, update_permissions, message_appointment,
    ]
    return ([schedule_ride] if store.get_rider(thread_id) else []) + tools


async def _relay(trip_id: str, message: str) -> None:
    store = get_store()
    trip = store.get_trip(trip_id)
    name = trip.appointment.name
    store.log(trip_id, "message_requested", f"Rider asked us to tell {name}: {message}")
    try:
        outcome = await actions.relay_message(trip_id, message)
    except actions.NotAllowed as e:
        await handle_update(thread_of(trip), f"The call to {name} was not made: {e}")
        return
    await handle_update(
        thread_of(trip),
        f"Outcome of the call to {name} (trip {trip_id}) with the rider's message ({message!r}): "
        f"{json.dumps(outcome) if outcome else 'the call ended without a clear outcome.'}",
    )


def _state_key(thread_id: str) -> str:
    return f"chat:{thread_id}"


async def _turn(thread_id: str, tag: str, text: str, kind: str) -> ChatMessage | None:
    """Run one agent turn; the history is append-only so cached prefixes and thinking stay valid."""
    store = get_store()
    state = store.get_json(_state_key(thread_id)) or {"history": [], "last_turn_at": None}

    since = datetime.fromisoformat(state["last_turn_at"]) if state["last_turn_at"] else None
    notices = [
        m.text for m in store.messages(thread_id)
        if m.kind == "notice" and (since is None or m.at > since)
    ]
    parts = [f"<rider>\n{json.dumps(context(thread_id), indent=2)}\n</rider>"]
    if notices:
        parts.append("<new_notices>\n" + "\n".join(notices) + "\n</new_notices>")
    parts.append(f"<{tag}>\n{text}\n</{tag}>")
    history = state["history"] + [{"role": "user", "content": "\n\n".join(parts)}]

    runner = get_client().beta.messages.tool_runner(
        model=get_settings().chat_model,
        max_tokens=16000,
        output_config={"effort": "medium"},
        system=prompts.load("chat"),
        tools=build_tools(thread_id),
        messages=history,
    )
    last = None
    async for message in runner:
        last = message
        history.append({"role": "assistant", "content": [b.to_dict() for b in message.content]})
        tool_response = await runner.generate_tool_call_response()
        if tool_response is not None:
            history.append(tool_response)

    reply = plain_text(final_text(last)) if last else ""
    message = None
    if reply:
        message = store.add_message(
            ChatMessage(thread_id=thread_id, sender="agent", kind=kind, text=reply)
        )
    # Saved after posting, so the agent's own notice doesn't come back as "new" next turn.
    store.put_json(_state_key(thread_id), {"history": history, "last_turn_at": now().isoformat()})
    return message


async def reply(thread_id: str, text: str, tag: str = "rider_message") -> list[ChatMessage]:
    """The rider wrote (or said) something. Returns their message and the agent's answer."""
    lock = _locks.setdefault(thread_id, asyncio.Lock())
    async with lock:
        rider = get_store().add_message(ChatMessage(thread_id=thread_id, sender="rider", text=text))
        try:
            answer = await _turn(thread_id, tag, text, "reply")
        except Exception:
            log.exception("chat turn failed for %s", thread_id)
            answer = post_notice(thread_id, "Sorry, something went wrong on my side. "
                                            "Please try again in a moment.")
        return [rider, answer] if answer else [rider]


async def handle_update(thread_id: str, update: str) -> None:
    """Something happened that the rider should hear about from the agent (e.g. a call ended)."""
    lock = _locks.setdefault(thread_id, asyncio.Lock())
    async with lock:
        try:
            await _turn(thread_id, "update", update, "notice")
        except Exception:
            log.exception("chat update failed for %s", thread_id)
            post_notice(thread_id, update)
