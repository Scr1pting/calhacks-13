"""The presentation's scripted ride: one simulated rider's van, through the live model, on the
dashboard's clock.

The dashboard's film follows one rider of the simulated day (presentation_ride.json, exported
by scripts/demo_ride.py) and posts its sim clock here. Each post moves the live model
(app.prediction.live) along the van's track up to that time, one fix per 15 sim-seconds, and
mirrors the result onto a real booked Trip, so the rider app shows it like any other ride: the
outlook while waiting, the pickup, the outlook and progress on board. When the live alert
fires, Leeway asks the rider whether to call the appointment (Trip.late_ask), and only a yes
places the real late-notice call (monitor.call_confirmed). Trip.demo keeps the monitor away.

Going back in time replays from the start, since the live model only moves forward. Live drive
times come from the demo cache (routing.replaying): a rehearsal records them, and the
presentation replays exactly that. `python -m app.demo.presentation` replays the whole ride and
prints what the rider app would show, minute by minute.

Times are minutes after midnight, on the day the ride was started (LA time).
"""

import argparse
import datetime
import json
import logging
import math
import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.core import bus
from app.core.schemas import (
    Contact,
    LateAsk,
    LiveStatus,
    Outlook,
    Permissions,
    Rider,
    Trip,
    TripStatus,
    now,
)
from app.core.store import get_store
from app.prediction import live, onboard, routing
from app.prediction.plan import BOARD_AFTER_START

log = logging.getLogger(__name__)

RIDE_PATH = Path(__file__).with_name("presentation_ride.json")
ALERT_BELOW = 0.5  # ask the rider once the chance of arriving on time drops below this
CURRENT = "presentation"  # store document naming the current presentation trip
SIM_WEEKDAY = 1  # the simulated day is a Tuesday: plan the drive for one


@dataclass(frozen=True)
class Ride:
    """A rider's trip, with the van's track: [[t, lat, lng], ...].

    From the simulated day (scripts/demo_ride.py), or made up to tell the story
    (scripts/example_ride.py), which also gives the van's street path with times for the
    dashboard's film ([[t, lat, lng], ...]) and the other riders' stops on the way.
    """

    sim_trip: str
    rider: str
    title: str
    appointment_name: str
    origin: str
    dest: str
    origin_pos: tuple[float, float]
    dest_pos: tuple[float, float]
    window_start: float
    appointment: float
    pickup_t: float
    dropoff_t: float
    track: list[list[float]]
    path: list[list[float]] = field(default_factory=list)
    stops_on_way: list[dict] = field(default_factory=list)
    # Leeway asks once it expects the rider this many minutes late (instead of below
    # ALERT_BELOW), so the question says how late; None: as for any trip.
    ask_late_min: float | None = None
    # The story's reschedule: the clinic moves the appointment this many minutes later.
    reschedule_min: float | None = None

    @classmethod
    def load(cls, path: Path = RIDE_PATH) -> "Ride":
        d = json.loads(path.read_text())
        d["origin_pos"], d["dest_pos"] = tuple(d["origin_pos"]), tuple(d["dest_pos"])
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})


def planned_drive(ride: Ride) -> float:
    """Direct drive minutes for a typical boarding time, on a Tuesday like the simulated day."""
    today = datetime.datetime.now(routing.TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    day = today + datetime.timedelta(days=(SIM_WEEKDAY - today.weekday()) % 7)
    depart = day + datetime.timedelta(minutes=ride.window_start + BOARD_AFTER_START)
    return routing.drive_minutes(ride.origin_pos, ride.dest_pos, depart)


def register(ride: Ride, live_id: str, drive_min: float, appointment: float | None = None):
    """A fresh live trip for the ride (replacing any under live_id)."""
    asks_late = ride.ask_late_min is not None
    return live.register(
        live.LiveTrip(
            live_id,
            ride.appointment if appointment is None else appointment,
            ride.window_start,
            ride.dest_pos,
            drive_min,
            ride.origin_pos,
            alert_below=0.0 if asks_late else ALERT_BELOW,
            alert_late_min=ride.ask_late_min if asks_late else live.onboard.ALERT_LATE_MIN,
        )
    )


def step(ride: Ride, live_id: str, point: list[float]) -> dict:
    """Apply one point of the track: the clock before pickup, then picked_up, then GPS."""
    t, lat, lng = point
    trip = live.get(live_id)
    if trip.phase == "scheduled" and t < ride.pickup_t:
        return live.handle_event(live_id, "refresh", None, t)
    if trip.phase == "scheduled":
        return live.handle_event(live_id, "picked_up", (lat, lng), t)
    if trip.phase == "onboard":
        return live.handle_event(live_id, "gps", (lat, lng), t)
    return live.status(trip, t)


# ---- the presentation trip ---------------------------------------------------------------


@dataclass
class Run:
    trip_id: str
    date: datetime.date
    drive_min: float
    next: int = 0  # index of the next track point to apply
    t: float = -math.inf  # sim clock of the last applied point
    published: str = ""  # the trip as last published to the rider app


_ride: Ride | None = None
_run: Run | None = None
_lock = threading.Lock()


def ride() -> Ride:
    global _ride
    if _ride is None:
        _ride = Ride.load()
    return _ride


def info() -> dict:
    """What the dashboard's film needs about the ride (GET /presentation and its snapshot)."""
    r = ride()
    return {
        "sim_trip": r.sim_trip,
        "rider": r.rider,
        "title": r.title,
        "appointment_name": r.appointment_name,
        "origin": r.origin,
        "dest": r.dest,
        "origin_pos": r.origin_pos,
        "dest_pos": r.dest_pos,
        "window_start": r.window_start,
        "appointment": r.appointment,
        "pickup_t": r.pickup_t,
        "dropoff_t": r.dropoff_t,
        "start": r.track[0][0],
        "end": r.track[-1][0],
        # A made-up ride (scripts/example_ride.py) brings its own street path and stops;
        # for one from the simulated day, the film finds them in its fleet.json.
        "path": r.path,
        "stops_on_way": r.stops_on_way,
        "ask_late_min": r.ask_late_min,
        "reschedule_min": r.reschedule_min,
    }


def at(run: Run, minutes: float) -> datetime.datetime:
    """Sim minutes as a time on the run's day."""
    midnight = datetime.datetime.combine(run.date, datetime.time(), routing.TZ)
    return midnight + datetime.timedelta(minutes=minutes)


def start(rider_id: str, appointment_phone: str = "") -> Trip:
    """A new presentation trip for the rider, booked for today, at the start of the ride.

    A new trip each time, so every run starts with the rider's whole call budget. The previous
    presentation trip is marked completed, so the rider app moves on to the new one.
    """
    global _run
    r = ride()
    store = get_store()
    profile = store.get_rider(rider_id)
    with _lock:
        old = store.get_json(CURRENT)
        if old and store.get_trip(old["trip_id"]):
            store.update_trip(old["trip_id"], lambda t: setattr(t, "status", TripStatus.completed))
            publish(store.get_trip(old["trip_id"]))
        date = datetime.datetime.now(routing.TZ).date()
        midnight = datetime.datetime.combine(date, datetime.time(), routing.TZ)
        trip = Trip(
            rider=Rider(name=profile.name if profile else r.rider),
            appointment=Contact(name=r.appointment_name, phone=appointment_phone),
            title=r.title,
            rider_id=rider_id,
            origin=r.origin,
            dest=r.dest,
            arrive_by=midnight + datetime.timedelta(minutes=r.appointment),
            permissions=Permissions(may_call_appointment=bool(appointment_phone)),
            status=TripStatus.booked,
            booked_pickup=midnight + datetime.timedelta(minutes=r.window_start),
            demo="presentation",
        )
        store.put_trip(trip)
        store.log(trip.id, "booked", f"Presentation ride: {r.sim_trip} from the simulated day.")
        publish(trip)
        with routing.replaying():
            drive_min = planned_drive(r)
        doc = {"trip_id": trip.id, "date": date.isoformat(), "drive_min": drive_min}
        store.put_json(CURRENT, doc)
        _run = Run(trip.id, date, drive_min)
        _reset(_run)
        _advance(_run, r.track[0][0])
        return store.get_trip(trip.id)


def advance(t: float) -> dict:
    """Move the presentation ride to sim time t (backwards replays from the start)."""
    with _lock:
        run = _current()
        if t < run.t:
            _reset(run)
        return _advance(run, t)


def resync(trip_id: str) -> None:
    """The trip changed outside the clock (a call moved the appointment): its chance and the
    rider app follow now, not at the film's next post."""
    with _lock:
        try:
            run = _current()
        except LookupError:
            return
        if run.trip_id == trip_id and run.next > 0:
            _advance(run, run.t)


def current_trip_id() -> str | None:
    doc = get_store().get_json(CURRENT)
    return doc["trip_id"] if doc else None


def _current() -> Run:
    """The run in memory, or rebuilt from the store after a restart."""
    global _run
    doc = get_store().get_json(CURRENT)
    if doc is None:
        raise LookupError("no presentation ride: start one first")
    if _run is None or _run.trip_id != doc["trip_id"]:
        date = datetime.date.fromisoformat(doc["date"])
        _run = Run(doc["trip_id"], date, doc["drive_min"])
        _reset(_run)
    return _run


def _reset(run: Run) -> None:
    """Back to the start: a fresh live trip, and the Trip as booked, with its calls unused."""
    register(ride(), run.trip_id, run.drive_min)
    run.next, run.t = 0, -math.inf

    def change(t: Trip):
        t.status = TripStatus.booked
        t.live = LiveStatus()
        t.outlook = t.late_ask = t.late_notice = None
        t.calls_used = 0
        t.arrive_by = at(run, ride().appointment)  # a call may have moved it

    get_store().update_trip(run.trip_id, change)


def _follow_appointment(run: Run, now: float) -> None:
    """The Trip's appointment moved (the clinic offered a new time on the call): the live model
    measures against the new time from here on, and its chance is worked out again now."""
    trip = get_store().get_trip(run.trip_id)
    midnight = datetime.datetime.combine(run.date, datetime.time(), routing.TZ)
    appointment = (trip.arrive_by.astimezone(routing.TZ) - midnight).total_seconds() / 60
    trip_live = live.get(run.trip_id)
    if abs(appointment - trip_live.appointment) < 0.01:
        return
    trip_live.appointment = appointment
    state = trip_live.state
    if state is not None:
        state.appointment = appointment
        if state.last_drive is not None:
            onboard.update_display(state, onboard.onboard_status(state, now, state.last_drive))


def _advance(run: Run, t: float) -> dict:
    r = ride()
    status = None
    _follow_appointment(run, max(run.t, r.track[0][0]))
    with routing.replaying():
        while run.next < len(r.track) and r.track[run.next][0] <= t:
            status = step(r, run.trip_id, r.track[run.next])
            run.t = r.track[run.next][0]
            run.next += 1
    if status is None:
        status = live.status(live.get(run.trip_id), max(run.t, r.track[0][0]))
    _sync(run, status)
    return {"trip_id": run.trip_id, "t": run.t, "status": status}


def _sync(run: Run, status: dict) -> None:
    """Mirror the live status onto the Trip; ask the rider once the alert fires."""
    store = get_store()
    trip_live = live.get(run.trip_id)
    eta = at(run, live.parse_clock(status["eta"]))
    if eta < at(run, run.t) - datetime.timedelta(hours=12):  # "HH:MM" past midnight
        eta += datetime.timedelta(days=1)
    alert = status.get("alert")
    asked = None

    def change(t: Trip):
        nonlocal asked
        phase = status["phase"]
        t.status = {"onboard": TripStatus.riding, "arrived": TripStatus.completed}.get(
            phase, TripStatus.booked
        )
        if trip_live.pickup_t is not None:
            t.live.picked_up_at = at(run, trip_live.pickup_t)
        if trip_live.arrived_t is not None:
            t.live.arrived_at = at(run, trip_live.arrived_t)
        t.live.progress = status.get("progress") if phase in ("onboard", "arrived") else None
        # Her phone knows where it is once she's aboard; before that, nobody knows where the van is.
        r = ride()
        t.live.origin, t.live.destination = r.origin_pos, r.dest_pos
        aboard = phase in ("onboard", "arrived") and run.next > 0
        t.live.position = tuple(r.track[run.next - 1][1:]) if aboard else None
        t.outlook = Outlook(
            checked_at=now(),
            p_on_time=status["p_on_time"],
            expected_arrival=eta,
            minutes_late=status["minutes_late_expected"],
        )
        if alert and t.late_ask is None and t.late_notice is None:
            asked = t.late_ask = LateAsk(
                asked_at=at(run, run.t), minutes_late=alert["minutes"], message=alert["message"]
            )

    trip = store.update_trip(run.trip_id, change)
    if asked:
        store.log(trip.id, "late_ask", asked.message, minutes_late=asked.minutes_late)
    data = trip.model_dump_json(exclude={"created_at": True, "outlook": {"checked_at"}})
    if data != run.published:
        run.published = data
        publish(trip)


def publish(trip: Trip) -> None:
    """Send the changed trip to the rider app (on the rider's stream, like a new trip)."""
    bus.publish(trip.rider_id, "trips", trip.model_dump_json())


# ---- the whole ride, ahead of time ---------------------------------------------------------

# per minutes moved: (planned drive it was made with, points)
_timelines: dict[float, tuple[float, list[dict]]] = {}


def timeline(moved: float = 0) -> list[dict]:
    """What the rider app will show at every point of the ride, worked out in memory.

    The dashboard's film times its shots from this (when the van comes, when Leeway asks) and
    draws the chance of arriving on time as it goes. It replays exactly what posting the clock
    does, on a separate live trip, so it never touches the presentation trip. With `moved`, for
    the appointment that many minutes later (the chance once the clinic has moved it).
    """
    r = ride()
    with routing.replaying():
        drive_min = planned_drive(r)
        cached = _timelines.get(moved)
        if cached is not None and cached[0] == drive_min:
            return cached[1]
        register(r, "presentation-timeline", drive_min, r.appointment + moved)
        points, asked = [], False
        for point in r.track:
            out = step(r, "presentation-timeline", point)
            alert = out.get("alert")
            low, high = out.get("eta_range") or [out["eta"]] * 2
            points.append({
                "t": point[0],
                "phase": out["phase"],
                "p_on_time": out["p_on_time"],
                "eta": live.parse_clock(out["eta"]),
                "eta_low": live.parse_clock(low),
                "eta_high": live.parse_clock(high),
                "minutes_late": out["minutes_late_expected"],
                "progress": out.get("progress"),
                "detour": bool(out.get("detour")),
                "stopped": bool(out.get("stopped")),
                # Leeway asks once, the first time the alert fires (as _sync does).
                "ask": alert["message"] if alert and not asked else None,
                "ask_minutes": alert["minutes"] if alert and not asked else None,
            })
            asked = asked or bool(alert)
    _timelines[moved] = (drive_min, points)
    return points


# ---- checking a ride ---------------------------------------------------------------------


def hhmm(t: float) -> str:
    m = round(t) % 1440
    return f"{m // 60}:{m % 60:02d}"


def check(r: Ride, live_id: str = "presentation-check") -> list[str]:
    """Replay the whole ride in memory and print the rider's view once a minute and at every
    event. Returns the live answers that weren't recorded yet (now recorded)."""
    with routing.replaying() as misses:
        drive_min = planned_drive(r)
        register(r, live_id, drive_min)
        print(f"{r.sim_trip}: {r.origin} -> {r.dest}, appointment {hhmm(r.appointment)}, "
              f"window from {hhmm(r.window_start)}, planned drive {drive_min:.0f} min")
        last_alert = None
        for point in r.track:
            t = point[0]
            out = step(r, live_id, point)
            note = ""
            if abs(t - r.pickup_t) < 0.25 and t >= r.pickup_t:
                note = "picked up"
            if out.get("alert") != last_alert:
                last_alert = out.get("alert")
                if last_alert:
                    note = f"{note}  ASK: {last_alert['message']}".strip()
            if note or t == round(t) or out["phase"] == "arrived":
                flags = " ".join(k for k in ("detour", "stopped", "stale") if out.get(k))
                print(f"{hhmm(t):>5}  {out['phase']:9} {out['p_on_time']:4.0%}  eta {out['eta']}"
                      f"  {flags:15} {note}")
            if out["phase"] == "arrived":
                break
    print(f"{len(misses)} live answers fetched (now recorded); 0 means the replay is exact.")
    return misses


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Replay the presentation ride and print it.")
    ap.add_argument("path", nargs="?", default=str(RIDE_PATH))
    check(Ride.load(Path(ap.parse_args().path)))
