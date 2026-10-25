"""A real phone call for the presentation.

The dashboard's live story (?live) has Leeway call "the clinic" on stage: this
places that call, to a number the server has approved (app.voice.numbers), as
an ordinary rider-message call. The dashboard follows it on the returned
trip's stream (GET /trips/{trip_id}/stream): call_started, call_progress with
the transcript so far, call_ended with what the callee answered.

The trip only exists to carry the call: it is stored as completed, so the
planner and the monitor leave it alone, and it belongs to no rider.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.jobs import spawn
from app.core.schemas import Contact, Rider, Trip, TripStatus, VoiceTaskKind, now
from app.core.store import get_store
from app.voice import numbers
from app.voice.calls import run_voice_task

from .trips import require_api_key

router = APIRouter(prefix="/demo", dependencies=[Depends(require_api_key)])


class DemoCall(BaseModel):
    phone: str
    rider_name: str = Field("Maria", max_length=40)
    clinic: str = Field(max_length=80)
    appointment_time: str = Field(max_length=20)  # as said on the call, e.g. "10:15 AM"
    message: str = Field(max_length=400)


class DemoCallStarted(BaseModel):
    trip_id: str
    phone: str


@router.post("/calls", status_code=202)
async def start_demo_call(body: DemoCall) -> DemoCallStarted:
    """Call the number with the message. 403 if it may not be called (see /call-numbers)."""
    try:
        number = numbers.authorize_call(body.phone)
    except numbers.NumberRejected as e:
        raise HTTPException(403, str(e)) from e
    trip = Trip(
        title="Presentation call",
        rider=Rider(name=body.rider_name),
        appointment=Contact(name=body.clinic, phone=number),
        origin="(presentation)",
        dest=body.clinic,
        arrive_by=now(),
        status=TripStatus.completed,
    )
    get_store().put_trip(trip)
    variables = {
        "rider_name": body.rider_name,
        "appointment_name": body.clinic,
        "appointment_time": body.appointment_time,
        "message": body.message,
    }
    spawn(run_voice_task(trip, VoiceTaskKind.rider_message, variables), name=f"demo-call:{trip.id}")
    return DemoCallStarted(trip_id=trip.id, phone=number)
