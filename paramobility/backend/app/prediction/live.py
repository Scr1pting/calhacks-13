"""Live trips: an in-memory store and lifecycle, scheduled -> waiting -> onboard -> arrived.

* scheduled / waiting (before / after the window opens): the estimate is ontime's, conditioned on
  the rider still waiting at `now`. GPS fixes while waiting only serve auto-pickup detection:
  moving >= 15 km/h for >= 60 s within 300 m of the pickup address after the window opened sets
  ask_picked_up, so the app can ask "Were you picked up?" (it never switches by itself).
* picked_up -> onboard: records the pickup time and polls routing (onboard.handle_gps) from the
  pickup position, or from the first fix after it.
* arrived: within 100 m of the destination for >= 60 s, or the rider says so. Tracking stops, the
  raw positions are dropped, and only `record` is kept for the rider's history.

Privacy: positions live only in memory, and only while tracking; they are never written to disk.
They are dropped on arrival, on stop_sharing, and 3 h after pickup. The record holds just the
pickup lateness, ride minutes, drive_at_pickup, trip key and date.

The clock is the event's `t` when events carry one (replays, tests) and LA wall time otherwise.
Times are minutes since midnight.
"""

import datetime
import re
import threading
from dataclasses import dataclass, field

from . import onboard, ontime, personal, routing
from .onboard import LatLng, hhmm, round_p
from .ride import ride_time

MAX_ACCURACY_M = 100.0  # drop fixes less accurate than this
PICKUP_RADIUS_M = 300.0
PICKUP_SPEED_KMH = 15.0
PICKUP_MOVING_MIN = 1.0
ARRIVE_RADIUS_M = 100.0
ARRIVE_DWELL_MIN = 1.0
GPS_TTL_MIN = 180.0  # drop positions this long after pickup

# what the live card shows; a change in any of these is pushed to stream subscribers
DISPLAY_KEYS = (
    "phase",
    "eta",
    "p_on_time",
    "detour",
    "stopped",
    "stale",
    "alert",
    "ask_picked_up",
    "sharing",
)


class EventError(Exception):
    """An event that doesn't fit the trip's phase (409) or is malformed (422)."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


@dataclass
class LiveTrip:
    trip_id: str
    appointment: float
    window_start: float
    destination: LatLng
    drive_min: float  # planned direct drive, for the estimate before the first live poll
    origin: LatLng | None = None  # pickup address; needed for auto-pickup detection
    history: tuple[personal.Trip, ...] = ()
    key: str | None = None  # recurring-trip id
    date: datetime.date | None = None
    phase: str = "scheduled"  # scheduled (or waiting, see _phase) | onboard | arrived
    clock: float | None = None  # time of the last event that carried one
    sharing: bool = True
    pickup_t: float | None = None
    arrived_t: float | None = None
    state: onboard.OnboardState | None = None
    last_fix: tuple[float, LatLng] | None = None  # (t, pos), waiting phase only
    moving_since: float | None = None
    ask_picked_up: bool = False
    near_dest_since: float | None = None
    record: dict | None = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    subscribers: list = field(default_factory=list, repr=False)  # (event loop, asyncio.Queue)
    last_pushed: tuple | None = None
    alert_below: float = onboard.ALERT_BELOW  # see onboard.OnboardState.alert_below


TRIPS: dict[str, LiveTrip] = {}


def register(trip: LiveTrip) -> LiveTrip:
    """Add or replace a trip (a replaced trip keeps its stream subscribers)."""
    old = TRIPS.get(trip.trip_id)
    if old is not None:
        trip.subscribers = old.subscribers
    TRIPS[trip.trip_id] = trip
    return trip


def get(trip_id: str) -> LiveTrip:
    """Raises KeyError for an unknown trip."""
    return TRIPS[trip_id]


def parse_clock(t: str) -> float:
    """'HH:MM' or 'HH:MM:SS' -> minutes since midnight; raises ValueError."""
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?", t)
    if not m:
        raise ValueError(f"invalid time {t!r}: expected HH:MM:SS, 24-hour")
    return int(m[1]) * 60 + int(m[2]) + float(m[3] or 0) / 60


def wall_clock() -> float:
    now = datetime.datetime.now(routing.TZ)
    return now.hour * 60 + now.minute + (now.second + now.microsecond / 1e6) / 60


def clock(trip: LiveTrip, t: float | None = None) -> float:
    if t is not None:
        trip.clock = t
    return trip.clock if trip.clock is not None else wall_clock()


def status(trip: LiveTrip, now: float | None = None) -> dict:
    """The status payload in any phase."""
    with trip.lock:
        now = clock(trip) if now is None else now
        _expire(trip, now)
        return _status(trip, now)


def handle_event(
    trip_id: str,
    kind: str,
    pos: LatLng | None = None,
    t: float | None = None,
    accuracy: float | None = None,
) -> dict:
    """Apply one event (picked_up, gps, refresh, stop_sharing, arrived) and return the status."""
    trip = get(trip_id)
    with trip.lock:
        now = clock(trip, t)
        _expire(trip, now)
        if kind == "picked_up":
            _picked_up(trip, now, pos)
        elif kind == "gps":
            if pos is None:
                raise EventError(422, "gps events need lat and lng")
            if accuracy is None or accuracy <= MAX_ACCURACY_M:
                _gps(trip, now, pos)
        elif kind == "refresh":
            if trip.phase == "onboard" and trip.sharing and trip.state.last_pos is not None:
                onboard.handle_gps(trip.state, now, trip.state.last_pos, refresh=True)
        elif kind == "stop_sharing":
            _stop_tracking(trip)
            if trip.phase == "onboard":
                trip.state.stale = True  # the estimate freezes
        elif kind == "arrived":
            if trip.phase != "onboard":
                raise EventError(409, f"can't arrive before pickup (phase {_phase(trip, now)})")
            _arrive(trip, now)
        else:
            raise EventError(422, f"unknown event type {kind!r}")
        out = _status(trip, now)
        _push(trip, out)
        return out


def _phase(trip: LiveTrip, now: float) -> str:
    """Before pickup the phase follows the clock (stored phase stays "scheduled")."""
    if trip.phase == "scheduled":
        return "waiting" if now >= trip.window_start else "scheduled"
    return trip.phase


def _status(trip: LiveTrip, now: float) -> dict:
    phase = _phase(trip, now)
    base = {"ask_picked_up": trip.ask_picked_up, "sharing": trip.sharing}
    if phase == "onboard":
        return {**onboard.payload(trip.state), **base}
    if phase == "arrived":
        late = trip.arrived_t - trip.appointment
        return {
            "phase": "arrived",
            "eta": hhmm(trip.arrived_t),
            "eta_range": [hhmm(trip.arrived_t)] * 2,
            "p_on_time": 1.0 if late <= 0 else 0.0,
            "minutes_late_expected": max(0, round(late)),
            "detour": False,
            "stopped": False,
            "stale": False,
            "progress": 1.0,
            "alert": None,
            **base,
            "record": trip.record,
        }
    ev = ontime.evaluate_window(
        trip.appointment, trip.window_start, trip.drive_min, trip.history, key=trip.key, now=now
    )
    q = {k: trip.appointment + v for k, v in ev["arrival_vs_appointment"].items()}
    return {
        "phase": phase,
        "eta": hhmm(q[0.5]),
        "eta_range": [hhmm(q[0.1]), hhmm(q[0.9])],
        "p_on_time": round_p(ev["p_on_time"]),
        "minutes_late_expected": max(0, round(q[0.5] - trip.appointment)),
        "detour": False,
        "stopped": False,
        "stale": False,
        "progress": 0.0,
        "alert": None,
        **base,
    }


def _picked_up(trip: LiveTrip, now: float, pos: LatLng | None) -> None:
    if trip.phase == "arrived":
        raise EventError(409, "trip already arrived")
    if trip.phase == "onboard":
        return  # repeated tap
    trip.phase, trip.pickup_t, trip.ask_picked_up = "onboard", now, False
    trip.last_fix = trip.moving_since = None
    trip.state = onboard.OnboardState(
        trip.trip_id, trip.appointment, trip.destination, alert_below=trip.alert_below
    )
    R = ride_time(trip.drive_min)  # until the first live poll: the full planned ride from now
    trip.state.fallback = {
        "eta": now + float(R.median()),
        "eta_lo": now + float(R.ppf(0.1)),
        "eta_hi": now + float(R.ppf(0.9)),
        "p_on_time": float(R.cdf(trip.appointment - now)),
    }
    if pos is not None and trip.sharing:
        onboard.handle_gps(trip.state, now, pos)


def _gps(trip: LiveTrip, now: float, pos: LatLng) -> None:
    phase = _phase(trip, now)
    if not trip.sharing:
        raise EventError(409, "location sharing was stopped for this trip")
    if phase == "onboard":
        onboard.handle_gps(trip.state, now, pos)
        if routing.distance_m(pos, trip.destination) <= ARRIVE_RADIUS_M:
            trip.near_dest_since = trip.near_dest_since if trip.near_dest_since is not None else now
            if now - trip.near_dest_since >= ARRIVE_DWELL_MIN:
                _arrive(trip, trip.near_dest_since)
        else:
            trip.near_dest_since = None
    elif phase == "waiting" and trip.origin is not None:
        _detect_pickup(trip, now, pos)
    else:
        raise EventError(409, f"no location tracking in phase {phase}")


def _detect_pickup(trip: LiveTrip, now: float, pos: LatLng) -> None:
    prev, trip.last_fix = trip.last_fix, (now, pos)
    if prev is None or now <= prev[0]:
        return
    kmh = routing.distance_m(prev[1], pos) / 1000 / ((now - prev[0]) / 60)
    near = routing.distance_m(pos, trip.origin) <= PICKUP_RADIUS_M
    if kmh >= PICKUP_SPEED_KMH and (near or trip.moving_since is not None):
        trip.moving_since = prev[0] if trip.moving_since is None else trip.moving_since
        trip.ask_picked_up = trip.ask_picked_up or now - trip.moving_since >= PICKUP_MOVING_MIN
    else:
        trip.moving_since = None


def _arrive(trip: LiveTrip, at: float) -> None:
    s = trip.state
    ride_min = at - trip.pickup_t
    trip.phase, trip.arrived_t = "arrived", at
    trip.record = {
        "date": (trip.date or datetime.datetime.now(routing.TZ).date()).isoformat(),
        "trip_key": trip.key,
        "window_start": hhmm(trip.window_start),
        "pickup_lateness_min": round(trip.pickup_t - trip.window_start, 1),
        "ride_min": round(ride_min, 1),
        "drive_at_pickup": None if s.drive_at_pickup is None else round(s.drive_at_pickup, 1),
        "ride_over_drive": None
        if not s.drive_at_pickup
        else round(ride_min / s.drive_at_pickup, 3),
    }
    _stop_tracking(trip)


def _stop_tracking(trip: LiveTrip) -> None:
    """Stop tracking and forget every raw position."""
    trip.sharing = False
    trip.last_fix = trip.moving_since = trip.near_dest_since = None
    if trip.state is not None:
        trip.state.last_pos = trip.state.last_call_pos = trip.state.move_anchor = None
        trip.state.stopped = False


def _expire(trip: LiveTrip, now: float) -> None:
    if trip.phase == "onboard" and trip.sharing and now - trip.pickup_t > GPS_TTL_MIN:
        _stop_tracking(trip)
        trip.state.stale = True


def subscribe(trip: LiveTrip, sub) -> None:
    trip.subscribers.append(sub)


def unsubscribe(trip: LiveTrip, sub) -> None:
    if sub in trip.subscribers:
        trip.subscribers.remove(sub)


def _push(trip: LiveTrip, out: dict) -> None:
    """Send out to stream subscribers if anything the card shows changed."""
    shown = tuple(repr(out.get(k)) for k in DISPLAY_KEYS)
    if shown == trip.last_pushed:
        return
    trip.last_pushed = shown
    for loop, queue in list(trip.subscribers):
        try:
            loop.call_soon_threadsafe(queue.put_nowait, out)
        except RuntimeError:  # that subscriber's loop is gone
            unsubscribe(trip, (loop, queue))
