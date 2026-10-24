"""Trip API used by the rider app and the dashboard."""

import secrets
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.agents import monitor, planner
from app.core.config import get_settings
from app.core.jobs import spawn
from app.core.schemas import AppointmentPolicy, Event, Trip, TripRequest, TripStatus, now
from app.core.store import get_store
from app.tools import model_tools
from app.tools.model_tools import ModelUnavailable


def require_api_key(x_api_key: str = Header("")) -> None:
    expected = get_settings().api_key
    if expected and not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(401, "invalid API key")


router = APIRouter(dependencies=[Depends(require_api_key)])


def _trip(trip_id: str) -> Trip:
    trip = get_store().get_trip(trip_id)
    if trip is None:
        raise HTTPException(404, "trip not found")
    return trip


def _start_planning(trip_id: str) -> None:
    spawn(planner.plan_trip(trip_id), name=f"plan:{trip_id}")


@router.post("/trips", status_code=202)
async def create_trip(request: TripRequest) -> Trip:
    trip = Trip(**request.model_dump())
    get_store().put_trip(trip)
    _start_planning(trip.id)
    return trip


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
    trip = _trip(trip_id)
    if trip.status not in (TripStatus.planned, TripStatus.failed):
        raise HTTPException(409, f"cannot replan a trip that is {trip.status}")

    def change(t: Trip):
        t.status = TripStatus.planning
        if body.certainty is not None:
            t.certainty = body.certainty

    trip = get_store().update_trip(trip_id, change)
    _start_planning(trip_id)
    return trip


@router.put("/trips/{trip_id}/policy")
async def set_policy(trip_id: str, policy: AppointmentPolicy) -> Trip:
    """The rider already knows the appointment's late policy. Replan afterwards to use it."""
    _trip(trip_id)
    policy.source = "rider"
    trip = get_store().update_trip(trip_id, lambda t: setattr(t, "policy", policy))
    get_store().log(trip_id, "policy_set", "Rider entered the appointment's late policy.",
                    policy=policy.model_dump())
    return trip


class BookRequest(BaseModel):
    pickup_time: datetime


@router.post("/trips/{trip_id}/book")
async def book(trip_id: str, body: BookRequest) -> Trip:
    """The rider confirms a pickup time. It must be one the model scored."""
    trip = _trip(trip_id)
    if trip.plan is None:
        raise HTTPException(409, "trip has no plan yet")
    scored = {o.pickup_time for o in trip.plan.tradeoff + trip.plan.options}
    if body.pickup_time not in scored:
        raise HTTPException(422, "pickup_time must be one of the plan's options")

    def change(t: Trip):
        t.booked_pickup = body.pickup_time
        t.status = TripStatus.booked

    trip = get_store().update_trip(trip_id, change)
    get_store().log(trip_id, "booked", f"Booked pickup for {body.pickup_time.isoformat()}.")
    return trip


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


@router.get("/trips/{trip_id}/distribution")
async def distribution(trip_id: str, pickup_time: datetime) -> dict:
    try:
        return model_tools.distribution(_trip(trip_id), pickup_time)
    except ModelUnavailable as e:
        raise HTTPException(503, str(e)) from e


@router.get("/calibration")
async def calibration() -> list[dict]:
    try:
        return model_tools.calibration()
    except ModelUnavailable as e:
        raise HTTPException(503, str(e)) from e
