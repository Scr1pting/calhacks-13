"""HTTP API for on-time advice: `uvicorn api:app --reload`.

Routing needs GOOGLE_MAPS_KEY or ORS_API_KEY in the environment (see routing.py) unless
requests pass drive_min themselves.
"""

import datetime
import os
import re

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import ontime
import personal
import prior
import ride
import routing

ARRIVAL_QUANTILES = (0.1, 0.5, 0.9)
BOARD_AFTER_START = 15.0  # minutes: drive time is looked up for a typical boarding time
DAILY_P_LATE = 0.053  # EBP Jul '25-Apr '26: 94.7% of pickups within the window
TIGHT_SLACK = prior.WINDOW  # minutes left after the median ride; less -> a van at the window's end is late

app = FastAPI(title="Paramobility prediction")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


def parse_time(time: str) -> int:
    match = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", time)
    if not match:
        raise HTTPException(422, f"invalid time {time!r}: expected HH:MM, 24-hour")
    return int(match[1]) * 60 + int(match[2])


class TripIn(BaseModel):
    window_start: str  # "HH:MM", start of a past trip's window
    lateness_min: float  # observed pickup minutes from window start
    days_ago: int = Field(ge=0)
    trip_key: str | None = None  # recurring-trip id (standing order, ...); None = rider-level only


class EvaluateWindowIn(BaseModel):
    appointment: str  # "HH:MM"
    window_start: str  # "HH:MM", EBP's confirmed window start
    date: datetime.date | None = None  # trip date (for traffic); default: next occurrence of today's weekday
    drive_min: float | None = Field(None, gt=0)  # either this ...
    origin: tuple[float, float] | None = None  # ... or origin + destination (lat, lng)
    destination: tuple[float, float] | None = None
    history: list[TripIn] = []
    trip_key: str | None = None  # this trip's recurring-trip id, matched against history
    target: float = Field(0.95, gt=0, lt=1)
    early_min: float = Field(30.0, ge=0)


class EvaluateWindowOut(BaseModel):
    appointment: str
    window: str  # "13:00–13:30"
    drive_min: float
    drive_source: str  # "given" | "google" | "ors"
    p_on_time: float
    p_very_early: float  # P(arriving more than early_min before the appointment)
    arrival_vs_appointment: dict[str, float]  # "0.1" / "0.5" / "0.9" -> minutes (negative = early)
    latest_window_start: str | None  # "HH:MM"
    target: float
    drivers: list[str]


def hhmm(minutes: float) -> str:
    m = round(float(minutes)) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def probability(p: float) -> float:
    return round(min(max(float(np.nan_to_num(p)), 0.0), 1.0), 3)


def drivers(appointment, window_start, drive_min, source, history, key) -> list[str]:
    """Up to three plain-language reasons behind the numbers, most personal first."""
    out = []
    d = personal.offset(history, 0, key)
    if abs(d.mean) > 0.1:
        # Credit this recurring trip unless the rider-wide offset moves it more. With only this
        # trip's history the two split the evidence evenly (equal prior shares), a tie.
        trip = d.trip_mean != 0 and abs(d.trip_mean) >= abs(d.rider_mean) - 1e-9
        whose = "This trip's past pickups" if trip else "Your past pickups"
        out.append(f"{whose} ran {'late' if d.mean > 0 else 'early'}")
    ride_median = float(ride.ride_time(drive_min).median())
    if appointment - window_start - ride_median < TIGHT_SLACK:
        out.append(f"Little room: the ride alone takes about {ride_median:.0f} min")
    part = "Morning" if window_start < 12 * 60 else "Afternoon" if window_start < 17 * 60 else "Evening"
    ratio = float(prior.p_late(window_start)) / DAILY_P_LATE
    if ratio > 1.25:
        out.append(f"{part} pickups run later than average")
    elif ratio < 0.75:
        out.append(f"{part} pickups are more punctual than average")
    if source == "google":
        out.append(f"Direct drive {drive_min:.0f} min at that time (traffic-aware)")
    return out[:3]


@app.post("/advice/evaluate-window")
def evaluate_window(req: EvaluateWindowIn) -> EvaluateWindowOut:
    """Chances of arriving on time with EBP's confirmed 30-min pickup window."""
    appointment = parse_time(req.appointment)
    window_start = parse_time(req.window_start)
    if window_start >= appointment:
        raise HTTPException(422, "window_start must be before the appointment")
    has_coords = req.origin is not None and req.destination is not None
    if (req.drive_min is not None) == has_coords or (req.origin is None) != (req.destination is None):
        raise HTTPException(422, "give either drive_min or both origin and destination")
    history = [personal.Trip(parse_time(t.window_start), t.lateness_min, -t.days_ago, t.trip_key)
               for t in req.history]
    try:  # windows 00:00-04:59 have no service
        prior.mu0(window_start)
        personal.offset(history, 0)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

    if req.drive_min is not None:
        drive_min, source = req.drive_min, "given"
    else:
        day = req.date or datetime.datetime.now(routing.TZ).date()  # routing rolls past times a week on
        depart = datetime.datetime.combine(day, datetime.time()) + datetime.timedelta(
            minutes=window_start + BOARD_AFTER_START)
        try:
            source = routing.provider()
            drive_min = routing.drive_minutes(req.origin, req.destination, depart)
        except routing.RoutingError as e:
            raise HTTPException(502, f"routing failed: {e}") from e

    ev = ontime.evaluate_window(appointment, window_start, drive_min, history, 0, req.early_min,
                                ARRIVAL_QUANTILES, key=req.trip_key)
    latest = ontime.latest_window_start(appointment, drive_min, history, 0, req.target, key=req.trip_key)
    return EvaluateWindowOut(
        appointment=hhmm(appointment),
        window=f"{hhmm(window_start)}–{hhmm(window_start + prior.WINDOW)}",
        drive_min=round(float(drive_min), 1),
        drive_source=source,
        p_on_time=probability(ev["p_on_time"]),
        p_very_early=probability(ev["p_very_early"]),
        arrival_vs_appointment={str(q): round(v, 1) for q, v in ev["arrival_vs_appointment"].items()},
        latest_window_start=None if latest is None else hhmm(latest),
        target=req.target,
        drivers=drivers(appointment, window_start, drive_min, source, history, req.trip_key),
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True}
