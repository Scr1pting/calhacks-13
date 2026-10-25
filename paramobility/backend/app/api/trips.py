"""Trip API used by the rider app and the dashboard."""

import secrets
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.agents import chat, monitor
from app.core.config import get_settings
from app.core.jobs import spawn
from app.core.schemas import (
    AppointmentPolicy,
    ChatMessage,
    Event,
    Trip,
    TripRequest,
    TripStatus,
    now,
)
from app.core.store import get_store
from app.core.thread import thread_of
from app.tools import model_tools, trip_ops
from app.tools.model_tools import ModelUnavailable
from app.tools.trip_ops import TripOpError

from .streams import sse


def require_api_key(x_api_key: str = Header(""), api_key: str = Query("")) -> None:
    """Normally a header; ?api_key= is for EventSource, which can't set headers."""
    expected = get_settings().api_key
    given = x_api_key or api_key
    if expected and not secrets.compare_digest(given, expected):
        raise HTTPException(401, "invalid API key")


router = APIRouter(dependencies=[Depends(require_api_key)])


def _trip(trip_id: str) -> Trip:
    try:
        return trip_ops.get(trip_id)
    except TripOpError as e:
        raise HTTPException(e.status, str(e)) from e


def _op(fn, *args, **kwargs) -> Trip:
    try:
        return fn(*args, **kwargs)
    except TripOpError as e:
        raise HTTPException(e.status, str(e)) from e


@router.post("/trips", status_code=202)
async def create_trip(request: TripRequest) -> Trip:
    return trip_ops.create(request)


@router.get("/trips")
async def list_trips() -> list[Trip]:
    return sorted(get_store().all_trips(), key=lambda t: t.created_at, reverse=True)


@router.get("/trips/{trip_id}")
async def get_trip(trip_id: str) -> Trip:
    return _trip(trip_id)


@router.get("/trips/{trip_id}/events")
async def trip_events(trip_id: str) -> list[Event]:
    _trip(trip_id)
    return get_store().events(trip_id)


class ReplanRequest(BaseModel):
    certainty: float | None = Field(None, ge=0.5, le=0.99)


@router.post("/trips/{trip_id}/plan", status_code=202)
async def replan(trip_id: str, body: ReplanRequest) -> Trip:
    return _op(trip_ops.start_planning, trip_id, body.certainty)


@router.put("/trips/{trip_id}/policy")
async def set_policy(trip_id: str, policy: AppointmentPolicy) -> Trip:
    """The rider already knows the appointment's late policy. Replan afterwards to use it."""
    return _op(trip_ops.set_policy, trip_id, policy)


class PermissionsUpdate(BaseModel):
    may_call_appointment: bool | None = None
    share_rider_name: bool | None = None
    max_calls: int | None = Field(None, ge=0)


@router.patch("/trips/{trip_id}/permissions")
async def update_permissions(trip_id: str, body: PermissionsUpdate) -> Trip:
    return _op(trip_ops.update_permissions, trip_id, **body.model_dump())


class AppointmentTime(BaseModel):
    arrive_by: datetime


@router.put("/trips/{trip_id}/appointment-time", status_code=202)
async def change_appointment_time(trip_id: str, body: AppointmentTime) -> Trip:
    """The appointment moved. Before pickup this replans and clears the booking."""
    return _op(trip_ops.change_appointment_time, trip_id, body.arrive_by)


class BookRequest(BaseModel):
    pickup_time: datetime


@router.post("/trips/{trip_id}/book")
async def book(trip_id: str, body: BookRequest) -> Trip:
    """The rider confirms a pickup time. It must be one the model scored."""
    return _op(trip_ops.book, trip_id, body.pickup_time)


class StatusUpdate(BaseModel):
    kind: Literal["van_eta", "picked_up", "arrived"]
    at: datetime | None = None  # defaults to now; for van_eta, the van's expected arrival


@router.post("/trips/{trip_id}/status")
async def update_status(trip_id: str, body: StatusUpdate) -> Trip:
    """Live updates from the rider app. Each one triggers a fresh delay check."""
    trip = _trip(trip_id)
    if trip.status not in (TripStatus.booked, TripStatus.riding):
        raise HTTPException(409, "trip is not booked")
    at = body.at or now()

    def change(t: Trip):
        if body.kind == "van_eta":
            t.live.van_eta = at
        elif body.kind == "picked_up":
            t.live.picked_up_at = at
            t.status = TripStatus.riding
        else:
            t.live.arrived_at = at
            t.status = TripStatus.completed

    trip = get_store().update_trip(trip_id, change)
    get_store().log(trip_id, body.kind, f"Status update: {body.kind} at {at.isoformat()}.")
    if trip.status == TripStatus.completed:
        model_tools.record_completed_trip(trip)
    else:
        spawn(monitor.check_trip(trip_id), name=f"check:{trip_id}")
    return trip


class LateAskAnswer(BaseModel):
    call: bool  # true: phone the appointment now; false: not now


@router.post("/trips/{trip_id}/late-ask")
async def answer_late_ask(trip_id: str, body: LateAskAnswer) -> Trip:
    """The rider's answer when Leeway asked whether to tell the appointment they'll be late.

    Yes places the late-notice call, within the rider's permissions and call limits.
    """
    trip = _trip(trip_id)
    if trip.late_ask is None:
        raise HTTPException(409, "Leeway hasn't asked about this trip")
    if trip.late_ask.answer is not None:
        raise HTTPException(409, "already answered")
    answer = "call" if body.call else "no"
    trip = get_store().update_trip(trip_id, lambda t: setattr(t.late_ask, "answer", answer))
    message = "Rider asked Leeway to call." if body.call else "Rider said not to call."
    get_store().log(trip_id, "late_ask_answered", message, answer=answer)
    if body.call:
        spawn(monitor.call_confirmed(trip_id), name=f"late-call:{trip_id}")
    return trip


# Chat with the agent. A trip with a rider profile shares the rider's
# conversation (see /riders/{rider_id}/messages); otherwise it has its own.


@router.get("/trips/{trip_id}/messages")
async def list_messages(trip_id: str) -> list[ChatMessage]:
    return get_store().messages(thread_of(_trip(trip_id)))


class RiderMessage(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/trips/{trip_id}/messages")
async def send_message(trip_id: str, body: RiderMessage) -> list[ChatMessage]:
    """The rider writes to the agent. Returns their message and the agent's reply."""
    return await chat.reply(thread_of(_trip(trip_id)), body.text)


@router.get("/trips/{trip_id}/stream")
async def stream(trip_id: str, request: Request):
    """Server-sent events: `events` for the activity log; `messages` for trips without a rider.

    Replays the trip's existing activity log on connect (see streams.sse) so the rider
    app still notices if planning already finished by the time this connects.
    """
    _trip(trip_id)

    def backlog() -> list[str]:
        return [e.model_dump_json() for e in get_store().events(trip_id)]

    return sse(request, trip_id, backlog=backlog)


# Dashboard


# Plain functions, so FastAPI runs the model's number crunching in its thread pool.


@router.get("/trips/{trip_id}/distribution")
def distribution(trip_id: str, pickup_time: datetime) -> dict:
    try:
        return model_tools.distribution(_trip(trip_id), pickup_time)
    except ModelUnavailable as e:
        raise HTTPException(503, str(e)) from e


@router.get("/calibration")
def calibration() -> list[dict]:
    try:
        return model_tools.calibration()
    except ModelUnavailable as e:
        raise HTTPException(503, str(e)) from e
