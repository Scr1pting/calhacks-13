"""Chat agent (Haiku): the rider's direct line to Paramobility, one thread per trip.

It answers questions from the trip's state and the delay model, and acts on the
rider's requests through the same operations and limits as the API. Heavy
planning goes to the Sonnet planner; calls run in the background and report
back into the thread through handle_update().
"""

import asyncio
import json
import logging
import re
from datetime import datetime

from anthropic import beta_async_tool

from app.core import prompts
from app.core.config import get_settings
from app.core.jobs import spawn
from app.core.llm import final_text, get_client
from app.core.schemas import AppointmentPolicy, ChatMessage, Trip, now
from app.core.store import get_store
from app.core.thread import notify_rider
from app.tools import actions, model_tools, trip_ops
from app.tools.model_tools import ModelUnavailable
from app.tools.trip_ops import TripOpError

log = logging.getLogger(__name__)
_locks: dict[str, asyncio.Lock] = {}


def trip_state(trip: Trip) -> dict:
    p = trip.permissions
    plan = trip.plan
    return {
        "now": now().astimezone(trip.arrive_by.tzinfo).isoformat(),
        "status": trip.status,
        "rider": trip.rider.name,
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


def plain_text(text: str) -> str:
    """The app shows messages as plain text, so drop markdown the model adds anyway."""
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"^\s*#+\s*", "", text, flags=re.M)
    return re.sub(r"^\s*[-*]\s+", "", text, flags=re.M)


def _parse_time(value: str, trip: Trip) -> datetime:
    t = datetime.fromisoformat(value)
    return t if t.tzinfo else t.replace(tzinfo=trip.arrive_by.tzinfo)


def build_tools(trip_id: str):
    store = get_store()

    def trip() -> Trip:
        return store.get_trip(trip_id)

    @beta_async_tool
    async def get_options(certainty: float) -> str:
        """Ask the delay model for the best pickup times at a given certainty.

        Use it for what-if questions such as "what if I want to be 95% sure?".
        It does not change the plan.

        Args:
            certainty: Chance of arriving on time, between 0.5 and 0.99.
        """
        try:
            opts = model_tools.options(trip(), certainty)
        except ModelUnavailable as e:
            return f"Error: {e}"
        if not opts:
            return "No pickup time reaches that certainty."
        return json.dumps([o.model_dump(mode="json") for o in opts])

    @beta_async_tool
    async def replan(certainty: float | None = None) -> str:
        """Make a new plan, optionally at a different certainty. Only when the rider asks.

        The planner runs in the background (it may phone the appointment) and
        posts the new plan in this thread when it's ready.

        Args:
            certainty: New chance of arriving on time to plan for, 0.5 to 0.99; omit to keep it.
        """
        try:
            trip_ops.start_planning(trip_id, certainty)
        except TripOpError as e:
            return f"Error: {e}"
        return "Planning started. The new plan will be posted in this thread."

    @beta_async_tool
    async def book_pickup(pickup_time: str) -> str:
        """Record the pickup time the rider has chosen. Only when the rider clearly confirms.

        Args:
            pickup_time: A pickup_time from the plan, copied exactly.
        """
        try:
            t = trip_ops.book(trip_id, _parse_time(pickup_time, trip()))
        except (TripOpError, ValueError) as e:
            return f"Error: {e}"
        return f"Booked pickup at {t.booked_pickup.isoformat()}."

    @beta_async_tool
    async def save_known_policy(
        grace_minutes: int, can_reschedule: bool | None = None, notes: str = ""
    ) -> str:
        """Save the appointment's late policy when the rider already knows it.

        Replan afterwards (if the rider wants) so the plan uses it.

        Args:
            grace_minutes: Minutes after the appointment time the rider can still be seen.
            can_reschedule: Whether the appointment can be moved if the ride runs late.
            notes: Anything else the rider said about the policy.
        """
        policy = AppointmentPolicy(
            grace_minutes=grace_minutes, can_reschedule=can_reschedule, notes=notes
        )
        trip_ops.set_policy(trip_id, policy)
        return "Policy saved."

    @beta_async_tool
    async def change_appointment_time(new_time: str) -> str:
        """Update the appointment time after it has actually been moved.

        Before pickup this starts a new plan (the old booking is cleared, so the
        rider must book again); during the ride it updates the arrival outlook.

        Args:
            new_time: The new appointment time as ISO 8601, in the trip's time zone.
        """
        try:
            t = trip_ops.change_appointment_time(trip_id, _parse_time(new_time, trip()))
        except (TripOpError, ValueError) as e:
            return f"Error: {e}"
        return f"Appointment time is now {t.arrive_by.isoformat()}; trip status {t.status}."

    @beta_async_tool
    async def update_permissions(
        may_call_appointment: bool | None = None,
        share_rider_name: bool | None = None,
        max_calls: int | None = None,
    ) -> str:
        """Change what the agents may do for this trip. Only exactly as the rider asks.

        Args:
            may_call_appointment: Whether agents may phone the appointment.
            share_rider_name: Whether calls may use the rider's name.
            max_calls: Most calls to the appointment for this trip, in total.
        """
        t = trip_ops.update_permissions(
            trip_id,
            may_call_appointment=may_call_appointment,
            share_rider_name=share_rider_name,
            max_calls=max_calls,
        )
        return f"Permissions now: {t.permissions.model_dump_json()}"

    @beta_async_tool
    async def message_appointment(message: str) -> str:
        """Phone the appointment and pass on a message from the rider.

        Only when the rider asks for it. Write the message as the rider wants it
        said, e.g. "Maya would like to take the 3:30 PM slot you offered." The
        call runs in the background and its outcome is posted in this thread.
        Counts toward the rider's call limit.

        Args:
            message: What to tell the appointment, in one or two sentences.
        """
        t = trip()
        if not t.permissions.may_call_appointment:
            return "Not allowed: the rider has turned off calls to the appointment."
        if t.calls_used >= t.permissions.max_calls:
            return f"Not allowed: the rider's limit of {t.permissions.max_calls} calls is used up."
        spawn(_relay(trip_id, message), name=f"relay:{trip_id}")
        return "Call started. The outcome will be posted in this thread."

    return [
        get_options, replan, book_pickup, save_known_policy,
        change_appointment_time, update_permissions, message_appointment,
    ]


async def _relay(trip_id: str, message: str) -> None:
    store = get_store()
    name = store.get_trip(trip_id).appointment.name
    store.log(trip_id, "message_requested", f"Rider asked us to tell {name}: {message}")
    try:
        outcome = await actions.relay_message(trip_id, message)
    except actions.NotAllowed as e:
        await handle_update(trip_id, f"The call to {name} was not made: {e}")
        return
    await handle_update(
        trip_id,
        f"Outcome of the call to {name} with the rider's message ({message!r}): "
        f"{json.dumps(outcome) if outcome else 'the call ended without a clear outcome.'}",
    )


def _state_key(trip_id: str) -> str:
    return f"chat:{trip_id}"


async def _turn(trip_id: str, tag: str, text: str, kind: str) -> ChatMessage | None:
    """Run one agent turn; the history is append-only so cached prefixes and thinking stay valid."""
    store = get_store()
    state = store.get_json(_state_key(trip_id)) or {"history": [], "last_turn_at": None}
    trip = store.get_trip(trip_id)

    since = datetime.fromisoformat(state["last_turn_at"]) if state["last_turn_at"] else None
    notices = [
        m.text for m in store.messages(trip_id)
        if m.kind == "notice" and (since is None or m.at > since)
    ]
    parts = [f"<trip>\n{json.dumps(trip_state(trip), indent=2)}\n</trip>"]
    if notices:
        parts.append("<new_notices>\n" + "\n".join(notices) + "\n</new_notices>")
    parts.append(f"<{tag}>\n{text}\n</{tag}>")
    history = state["history"] + [{"role": "user", "content": "\n\n".join(parts)}]

    runner = get_client().beta.messages.tool_runner(
        model=get_settings().chat_model,
        max_tokens=16000,
        output_config={"effort": "medium"},
        system=prompts.load("chat"),
        tools=build_tools(trip_id),
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
            ChatMessage(trip_id=trip_id, sender="agent", kind=kind, text=reply)
        )
    # Saved after posting, so the agent's own notice doesn't come back as "new" next turn.
    store.put_json(_state_key(trip_id), {"history": history, "last_turn_at": now().isoformat()})
    return message


async def reply(trip_id: str, text: str) -> list[ChatMessage]:
    """The rider wrote in the app. Returns their message and the agent's answer."""
    lock = _locks.setdefault(trip_id, asyncio.Lock())
    async with lock:
        rider = get_store().add_message(ChatMessage(trip_id=trip_id, sender="rider", text=text))
        try:
            answer = await _turn(trip_id, "rider_message", text, "reply")
        except Exception:
            log.exception("chat turn failed for %s", trip_id)
            answer = notify_rider(trip_id, "Sorry, something went wrong on my side. "
                                           "Please try again in a moment.")
        return [rider, answer] if answer else [rider]


async def handle_update(trip_id: str, update: str) -> None:
    """Something happened that the rider should hear about from the agent (e.g. a call ended)."""
    lock = _locks.setdefault(trip_id, asyncio.Lock())
    async with lock:
        try:
            await _turn(trip_id, "update", update, "notice")
        except Exception:
            log.exception("chat update failed for %s", trip_id)
            notify_rider(trip_id, update)
