"""The presentation ride (app.demo.presentation): started from the rider app's demo panel, then
moved along by the dashboard's film clock."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.trips import require_api_key
from app.core.schemas import Trip
from app.demo import presentation

router = APIRouter(prefix="/presentation", dependencies=[Depends(require_api_key)])


class StartIn(BaseModel):
    rider_id: str
    appointment_phone: str = ""  # the number Leeway calls as the appointment; empty: no calls


class ClockIn(BaseModel):
    t: float = Field(ge=0, lt=1440)  # sim minutes after midnight


@router.get("")
def get_ride() -> dict:
    """Which simulated trip the ride replays (the dashboard follows its van), and its trip."""
    return {**presentation.info(), "trip_id": presentation.current_trip_id()}


@router.get("/timeline")
def get_timeline() -> list[dict]:
    """The rider app's view at every point of the ride (t, chance, ETA and its range, when
    Leeway asks), worked out ahead so the dashboard can time its shots."""
    return presentation.timeline()


@router.post("/start")
def start(body: StartIn) -> Trip:
    """A new presentation trip for this rider, at the start of the ride."""
    return presentation.start(body.rider_id, body.appointment_phone)


@router.post("/clock")
def clock(body: ClockIn) -> dict:
    """Move the ride to sim time t. Earlier than the last post replays from the start."""
    try:
        return presentation.advance(body.t)
    except LookupError as e:
        raise HTTPException(409, str(e)) from e
