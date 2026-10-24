"""Place a call with a Cartesia agent and wait for what it learned.

The phone agent reports its findings through a webhook tool (see app.api.voice).
If it hangs up without doing so, the transcript is handed to Haiku instead.
"""

import asyncio
import logging

from app.agents import extract
from app.core.config import get_settings
from app.core.schemas import Trip, VoiceTask, VoiceTaskKind
from app.core.store import get_store

from .cartesia import CartesiaClient, CartesiaError

log = logging.getLogger(__name__)
POLL_SECONDS = 5


def _agent_id(kind: VoiceTaskKind) -> str:
    s = get_settings()
    return {
        VoiceTaskKind.policy_inquiry: s.cartesia_policy_agent_id,
        VoiceTaskKind.late_notice: s.cartesia_late_agent_id,
        VoiceTaskKind.rider_message: s.cartesia_message_agent_id,
    }[kind]


async def run_voice_task(trip: Trip, kind: VoiceTaskKind, variables: dict) -> VoiceTask:
    store = get_store()
    settings = get_settings()
    task = VoiceTask(trip_id=trip.id, kind=kind)
    agent_id = _agent_id(kind)
    if not (settings.voice_enabled and agent_id):
        task.status = "skipped"
        store.put_voice_task(task)
        store.log(trip.id, "call_skipped", "Voice calling is not configured, so no call was made.")
        return task

    store.put_voice_task(task)
    variables = {**variables, "task_id": task.id}
    async with CartesiaClient() as cartesia:
        try:
            call_id = await cartesia.start_call(agent_id, trip.appointment.phone, variables)
        except CartesiaError as e:
            task.status = "failed"
            store.put_voice_task(task)
            store.log(trip.id, "call_failed", f"Could not call {trip.appointment.name}.",
                      error=str(e))
            return task
        # Reload first: the webhook may already have saved a result for this task.
        task = store.get_voice_task(task.id) or task
        task.call_id = call_id
        task.status = "started"
        store.put_voice_task(task)
        store.log(trip.id, "call_started", f"Calling {trip.appointment.name}.",
                  call_id=task.call_id)

        call = await _wait_for_end(cartesia, task.call_id, settings.call_timeout_seconds)

    # The webhook may have written a result while the call was running.
    task = store.get_voice_task(task.id) or task
    task.status = call.get("status", "failed")
    task.transcript = call.get("transcript") or []
    if task.result is None and task.transcript:
        task.result = await extract.from_transcript(kind, task.transcript)
    store.put_voice_task(task)
    store.log(
        trip.id,
        "call_ended",
        f"Call with {trip.appointment.name} ended.",
        call_id=task.call_id,
        status=task.status,
        summary=call.get("summary"),
        result=task.result,
    )
    return task


async def _wait_for_end(cartesia: CartesiaClient, call_id: str, timeout: int) -> dict:
    call: dict = {}
    for _ in range(timeout // POLL_SECONDS):
        try:
            call = await cartesia.get_call(call_id)
        except CartesiaError:
            log.warning("polling call %s failed", call_id, exc_info=True)
        if call.get("status") in ("completed", "failed"):
            return call
        await asyncio.sleep(POLL_SECONDS)
    return call
