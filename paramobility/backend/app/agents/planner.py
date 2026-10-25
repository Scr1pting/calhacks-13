"""Planner agent (Sonnet): learns the appointment's policy and picks a pickup time.

Claude decides what to find out and which option fits the rider, but every
probability and wait time comes from the delay model. submit_plan only accepts
pickup times the model has scored and stores the model's numbers, not Claude's.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta

from anthropic import beta_async_tool

from app.core import prompts
from app.core.config import get_settings
from app.core.llm import FALLBACK_BETA, final_text, get_client
from app.core.schemas import Plan, Trip, TripOption, TripStatus
from app.core.store import get_store
from app.core.thread import notify_rider
from app.prediction.prior import WINDOW
from app.tools import actions, model_tools
from app.tools.model_tools import ModelUnavailable

log = logging.getLogger(__name__)


def _rows(opts: list[TripOption]) -> str:
    return json.dumps([o.model_dump(mode="json") for o in opts])


def trip_brief(trip: Trip) -> str:
    p = trip.permissions
    return json.dumps(
        {
            "rider": trip.rider.name,
            "appointment": trip.appointment.name,
            "appointment_for": trip.title,
            "origin": trip.origin,
            "destination": trip.dest,
            "arrive_by": trip.arrive_by.isoformat(),
            "certainty_wanted": trip.certainty,
            "rider_notes": trip.notes,
            "known_policy": trip.policy.model_dump() if trip.policy else None,
            "rider_allows": {
                "calling_the_appointment": p.may_call_appointment,
                "calls_left": p.max_calls - trip.calls_used,
            },
        },
        indent=2,
    )


def build_tools(trip_id: str):
    store = get_store()
    scored: dict[datetime, TripOption] = {}

    def remember(opts: list[TripOption]) -> list[TripOption]:
        for o in opts:
            scored[o.pickup_time] = o
        return opts

    @beta_async_tool
    async def get_tradeoff() -> str:
        """Score candidate pickup times with the delay model.

        Returns pickup_time, p_on_time (chance of arriving by the appointment
        time plus its grace period) and expected_wait_minutes (time spent
        waiting at the appointment) for each candidate. Uses the known grace
        period, so call it again after the policy changes.
        """
        try:
            trip = store.get_trip(trip_id)
            return _rows(remember(await asyncio.to_thread(model_tools.tradeoff, trip)))
        except ModelUnavailable as e:
            return f"Error: {e}"

    @beta_async_tool
    async def get_options(certainty: float) -> str:
        """Best pickup times that reach the given chance of arriving on time.

        Args:
            certainty: Required chance of arriving on time, between 0.5 and 0.99.
        """
        try:
            trip = store.get_trip(trip_id)
            opts = await asyncio.to_thread(model_tools.options, trip, certainty)
            return _rows(remember(opts))
        except ModelUnavailable as e:
            return f"Error: {e}"

    @beta_async_tool
    async def call_appointment_for_policy(questions: str) -> str:
        """Phone the appointment to learn how late the rider can arrive.

        A voice agent asks about the grace period, whether the appointment can
        be moved, and anything in questions. Takes a few minutes. Counts toward
        the rider's call limit.

        Args:
            questions: Extra questions for this call, in plain language. May be empty.
        """
        try:
            policy = await actions.inquire_policy(trip_id, questions)
        except actions.NotAllowed as e:
            return f"Not allowed: {e}"
        if policy is None:
            return "The call did not produce a usable answer. Plan without a grace period."
        store.log(trip_id, "policy_learned", "Learned the appointment's late policy by phone.",
                  policy=policy.model_dump())
        return f"Policy saved: {policy.model_dump_json()}"

    @beta_async_tool
    async def submit_plan(pickup_time: str, explanation: str) -> str:
        """Save the recommended pickup time for the rider. Call exactly once, at the end.

        Args:
            pickup_time: A pickup_time from get_tradeoff or get_options, copied
                exactly.
            explanation: Two or three plain sentences for the rider on why this
                time. Leave out probabilities and minutes; the app shows the
                model's numbers next to it.
        """
        try:
            chosen = scored[datetime.fromisoformat(pickup_time)]
        except (KeyError, ValueError):
            return "Error: copy pickup_time exactly from a get_tradeoff or get_options row."
        trip = store.get_trip(trip_id)
        try:
            opts = await asyncio.to_thread(model_tools.options, trip, trip.certainty)
            trade = await asyncio.to_thread(model_tools.tradeoff, trip)
        except ModelUnavailable as e:
            return f"Error: {e}"
        await finalize_plan(trip_id, chosen, explanation, opts, trade)
        return "Plan saved."

    return [get_tradeoff, get_options, call_appointment_for_policy, submit_plan]


async def finalize_plan(
    trip_id: str,
    chosen: TripOption,
    explanation: str,
    opts: list[TripOption],
    trade: list[TripOption],
) -> None:
    """Save a plan and notify the rider. Shared by submit_plan and the no-call fast path below."""
    store = get_store()
    trip = store.get_trip(trip_id)
    plan = Plan(recommended=chosen, options=opts, tradeoff=trade, explanation=explanation)

    def save(t: Trip):
        t.plan = plan
        t.status = TripStatus.planned
        t.error = ""

    store.update_trip(trip_id, save)
    store.log(trip_id, "plan_ready", explanation, recommended=chosen.model_dump(mode="json"))
    # The numbers in the notice come from the model, not from Claude.
    notify_rider(trip_id, (
        f"Your plan{f' for {trip.title.lower()}' if trip.title else ''} is ready: "
        f"pickup window {actions.clock(chosen.pickup_time, trip.arrive_by)}–"
        f"{actions.clock(chosen.pickup_time + timedelta(minutes=WINDOW), trip.arrive_by)}, "
        f"with a {chosen.p_on_time:.0%} chance of arriving on time and about "
        f"{chosen.expected_wait_minutes:.0f} min of waiting. {explanation}"
    ))


def _fast_explanation(reached_certainty: bool) -> str:
    base = (
        "This is the latest pickup that still meets the chance you asked for, so you "
        "won't wait around longer than you need to."
        if reached_certainty
        else "I couldn't find a pickup that reaches the chance you asked for, so this is "
        "the best option I found."
    )
    return (
        f"{base} I didn't check with the appointment for a grace period, so this doesn't "
        "count on them holding your slot. It's your call whether to book it."
    )


async def plan_fast(trip_id: str, trip: Trip) -> bool:
    """Plan directly from the delay model, no LLM round-trip.

    When the rider hasn't allowed a call to the appointment, there's nothing
    for the planner agent to decide — get_tradeoff/get_options would be its
    only real tool calls anyway. Skipping the tool-use conversation entirely
    turns "Arrange rides" into a near-instant plan instead of a multi-turn
    agent exchange. Returns whether a plan was saved.
    """
    try:
        opts = await asyncio.to_thread(model_tools.options, trip, trip.certainty)
        trade = await asyncio.to_thread(model_tools.tradeoff, trip)
    except ModelUnavailable:
        return False
    if not trade:
        return False
    chosen = opts[0] if opts else max(trade, key=lambda o: o.p_on_time)
    await finalize_plan(trip_id, chosen, _fast_explanation(bool(opts)), opts, trade)
    return True


async def plan_trip(trip_id: str) -> None:
    store = get_store()
    trip = store.get_trip(trip_id)
    store.log(trip_id, "planning", "Planning started.")

    if not trip.permissions.may_call_appointment:
        if await plan_fast(trip_id, trip):
            return
        # Delay model unavailable: fall through to the full agent, which will
        # hit the same error via get_tradeoff/get_options and fail cleanly.

    try:
        runner = get_client().beta.messages.tool_runner(
            model=get_settings().planner_model,
            max_tokens=16000,
            output_config={"effort": "medium"},
            betas=[FALLBACK_BETA],
            fallbacks="default",
            system=prompts.load("planner"),
            tools=build_tools(trip_id),
            messages=[{"role": "user", "content": f"<trip>\n{trip_brief(trip)}\n</trip>"}],
        )
        final = await runner.until_done()
        summary = final_text(final)
    except Exception as e:  # any failure should leave the trip marked failed, not stuck
        log.exception("planner failed for %s", trip_id)
        summary = f"Planner error: {e}"

    trip = store.get_trip(trip_id)
    # Still planning means no plan was saved. Anything else (planned, or already
    # booked by the rider while Claude wrote its last sentence) is a success.
    if trip.status == TripStatus.planning:
        def fail(t: Trip):
            t.status = TripStatus.failed
            t.error = summary or "The planner finished without a plan."

        store.update_trip(trip_id, fail)
        store.log(trip_id, "planning_failed", "Could not make a plan.", detail=summary)
        notify_rider(trip_id, "I couldn't make a plan this time. You can ask me to try again.")
