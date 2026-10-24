"""Delay-model API: on-time advice for a confirmed pickup window, and live trips.

Routing needs GOOGLE_MAPS_KEY or ORS_API_KEY (Settings) unless requests pass drive_min
themselves. Live trips (app.prediction.live) are kept in memory: a restart forgets them.

The live endpoints sit under /live for now, apart from the agent's /trips, until live
tracking is folded into the trip lifecycle.
"""

import asyncio
import datetime
import re
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.prediction import live, ontime, personal, prior, ride, routing, sim

from .trips import require_api_key

ARRIVAL_QUANTILES = (0.1, 0.5, 0.9)
BOARD_AFTER_START = 15.0  # minutes: drive time is looked up for a typical boarding time
DAILY_P_LATE = 0.053  # EBP Jul '25-Apr '26: 94.7% of pickups within the window
# minutes left after the median ride; less -> a van at the window's end is late
TIGHT_SLACK = prior.WINDOW

router = APIRouter(dependencies=[Depends(require_api_key)])
live_router = APIRouter(prefix="/live", dependencies=[Depends(require_api_key)])


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
    date: datetime.date | None = (
        None  # trip date (for traffic); default: next occurrence of today's weekday
    )
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


def history_trips(history: list[TripIn]) -> list[personal.Trip]:
    return [
        personal.Trip(parse_time(t.window_start), t.lateness_min, -t.days_ago, t.trip_key)
        for t in history
    ]


def check_service(window_start: float, history: list[personal.Trip]) -> None:
    """422 for windows 00:00-04:59 (no service), also in the history."""
    try:
        prior.mu0(window_start)
        personal.offset(history, 0)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


def planned_drive(drive_min, origin, destination, date, window_start) -> tuple[float, str]:
    """(drive minutes, source): drive_min if given, else routed for a typical boarding time.

    Routing failures are a 502.
    """
    if drive_min is not None:
        return drive_min, "given"
    day = date or datetime.datetime.now(routing.TZ).date()  # routing rolls past times a week on
    depart = datetime.datetime.combine(day, datetime.time()) + datetime.timedelta(
        minutes=window_start + BOARD_AFTER_START
    )
    try:
        return routing.drive_minutes(origin, destination, depart), routing.provider()
    except routing.RoutingError as e:
        raise HTTPException(502, f"routing failed: {e}") from e


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
    part = (
        "Morning"
        if window_start < 12 * 60
        else "Afternoon"
        if window_start < 17 * 60
        else "Evening"
    )
    ratio = float(prior.p_late(window_start)) / DAILY_P_LATE
    if ratio > 1.25:
        out.append(f"{part} pickups run later than average")
    elif ratio < 0.75:
        out.append(f"{part} pickups are more punctual than average")
    if source == "google":
        out.append(f"Direct drive {drive_min:.0f} min at that time (traffic-aware)")
    return out[:3]


@router.post("/advice/evaluate-window")
def evaluate_window(req: EvaluateWindowIn) -> EvaluateWindowOut:
    """Chances of arriving on time with EBP's confirmed 30-min pickup window."""
    appointment = parse_time(req.appointment)
    window_start = parse_time(req.window_start)
    if window_start >= appointment:
        raise HTTPException(422, "window_start must be before the appointment")
    has_coords = req.origin is not None and req.destination is not None
    if (req.drive_min is not None) == has_coords or (req.origin is None) != (
        req.destination is None
    ):
        raise HTTPException(422, "give either drive_min or both origin and destination")
    history = history_trips(req.history)
    check_service(window_start, history)
    drive_min, source = planned_drive(
        req.drive_min, req.origin, req.destination, req.date, window_start
    )

    ev = ontime.evaluate_window(
        appointment,
        window_start,
        drive_min,
        history,
        0,
        req.early_min,
        ARRIVAL_QUANTILES,
        key=req.trip_key,
    )
    latest = ontime.latest_window_start(
        appointment, drive_min, history, 0, req.target, key=req.trip_key
    )
    return EvaluateWindowOut(
        appointment=hhmm(appointment),
        window=f"{hhmm(window_start)}–{hhmm(window_start + prior.WINDOW)}",
        drive_min=round(float(drive_min), 1),
        drive_source=source,
        p_on_time=probability(ev["p_on_time"]),
        p_very_early=probability(ev["p_very_early"]),
        arrival_vs_appointment={
            str(q): round(v, 1) for q, v in ev["arrival_vs_appointment"].items()
        },
        latest_window_start=None if latest is None else hhmm(latest),
        target=req.target,
        drivers=drivers(appointment, window_start, drive_min, source, history, req.trip_key),
    )


class LiveTripIn(BaseModel):
    appointment: str  # "HH:MM"
    window_start: str  # "HH:MM", EBP's confirmed window start
    destination: tuple[float, float]  # (lat, lng)
    origin: tuple[float, float] | None = (
        None  # pickup address: needed for auto-pickup and routed drive_min
    )
    drive_min: float | None = Field(
        None, gt=0
    )  # planned direct drive; routed from origin if missing
    date: datetime.date | None = None
    history: list[TripIn] = []
    trip_key: str | None = None


class EventIn(BaseModel):
    type: Literal["picked_up", "gps", "arrived", "refresh", "stop_sharing"]
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    t: str | None = None  # "HH:MM:SS"; default: the server's clock (LA time)
    accuracy: float | None = Field(None, ge=0)  # meters; fixes worse than 100 m are ignored


class LiveStatus(BaseModel):
    phase: str  # scheduled | waiting | onboard | arrived
    eta: str  # "HH:MM", displayed (smoothed) arrival
    eta_range: list[str]  # 10th and 90th percentile, "HH:MM"
    p_on_time: float  # rounded to 5%
    minutes_late_expected: int
    detour: bool  # "Your van is making another stop"
    stopped: bool  # "Your van is stopped — likely picking someone up"
    stale: bool  # routing failed or tracking stopped: the estimate is frozen
    progress: float  # share of the ride done, 0-1
    alert: (
        dict | None
    )  # {"type": "running_late", "minutes", "message"}; sending needs the rider's confirmation
    ask_picked_up: bool  # auto-detected movement at the pickup: ask "Were you picked up?"
    sharing: bool  # location tracking on
    record: dict | None = None  # arrived only: what to keep for the rider's history


class ReplayIn(BaseModel):
    trip_id: str
    track: list[tuple[float, float, str]] | None = (
        None  # [[lat, lng, "HH:MM:SS"], ...]; generated if missing
    )
    speed: float = Field(10.0, gt=0)  # x real time
    start: str | None = (
        None  # "HH:MM:SS" departure for a generated track; default: the window start
    )


def live_trip(trip_id: str) -> live.LiveTrip:
    try:
        return live.get(trip_id)
    except KeyError:
        raise HTTPException(404, f"unknown trip {trip_id!r}") from None


def clock_time(t: str) -> float:
    try:
        return live.parse_clock(t)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@live_router.put("/trips/{trip_id}")
def put_trip(trip_id: str, req: LiveTripIn) -> LiveStatus:
    """Register (or replace) a trip for live tracking."""
    appointment = parse_time(req.appointment)
    window_start = parse_time(req.window_start)
    if window_start >= appointment:
        raise HTTPException(422, "window_start must be before the appointment")
    if req.drive_min is None and req.origin is None:
        raise HTTPException(422, "give drive_min or origin")
    history = history_trips(req.history)
    check_service(window_start, history)
    drive_min, _ = planned_drive(req.drive_min, req.origin, req.destination, req.date, window_start)
    trip = live.register(
        live.LiveTrip(
            trip_id,
            appointment,
            window_start,
            req.destination,
            drive_min,
            req.origin,
            tuple(history),
            req.trip_key,
            req.date,
        )
    )
    return LiveStatus(**live.status(trip))


@live_router.post("/trips/{trip_id}/events")
def post_event(trip_id: str, ev: EventIn) -> LiveStatus:
    """picked_up | gps | arrived | refresh | stop_sharing.

    gps needs lat/lng and is only taken on board,
    or while waiting when the trip has an origin (auto-pickup detection)."""
    live_trip(trip_id)
    pos = None if ev.lat is None or ev.lng is None else (ev.lat, ev.lng)
    t = None if ev.t is None else clock_time(ev.t)
    try:
        return LiveStatus(**live.handle_event(trip_id, ev.type, pos, t, ev.accuracy))
    except live.EventError as e:
        raise HTTPException(e.status, e.detail) from e


@live_router.get("/trips/{trip_id}/status")
def get_status(trip_id: str) -> LiveStatus:
    return LiveStatus(**live.status(live_trip(trip_id)))


@live_router.websocket("/trips/{trip_id}/stream")
async def stream(ws: WebSocket, trip_id: str):
    """Sends the status now and again whenever what the card shows changes."""
    try:
        trip = live.get(trip_id)
    except KeyError:
        await ws.close(code=4404, reason="unknown trip")
        return
    await ws.accept()
    sub = (asyncio.get_running_loop(), asyncio.Queue())
    live.subscribe(trip, sub)
    try:
        await ws.send_json(await run_in_threadpool(live.status, trip))
        while True:
            await ws.send_json(await sub[1].get())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        live.unsubscribe(trip, sub)


@live_router.post("/sim/replay")
def post_replay(req: ReplayIn) -> dict:
    """Replay a GPS track as live events in the background (demo). Without a track, one is generated
    along Google's route from the trip's origin, with a detour and a 4-min stop."""
    trip = live_trip(req.trip_id)
    if req.track is not None:
        track = [list(p) for p in req.track]
        for p in track:
            clock_time(p[2])
    else:
        if trip.origin is None:
            raise HTTPException(422, "the trip has no origin to generate a track from")
        start = trip.window_start if req.start is None else clock_time(req.start)
        try:
            track = sim.generate_track(trip.origin, trip.destination, start)
        except routing.RoutingError as e:
            raise HTTPException(502, f"routing failed: {e}") from e
    if not track:
        raise HTTPException(422, "empty track")
    sim.start_replay(req.trip_id, track, req.speed)
    span = live.parse_clock(track[-1][2]) - live.parse_clock(track[0][2])
    return {
        "trip_id": req.trip_id,
        "points": len(track),
        "seconds": round(span * 60 / req.speed, 1),
        "track": track,
    }
