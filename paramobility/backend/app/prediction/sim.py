"""Demo mode: generate a GPS track for a trip and replay it as live events.

The track follows Google's driving route, timed by its steps, with one detour (DETOUR_KM off the
route, mostly back toward the origin, and back: a pure side-step would barely change the drive
time to the destination) and one STOP_MIN stop (6 min; at 4 min the flag would only just
appear), so both the detour and stopped flags show. It ends with a dwell at the destination, so
arrival is detected.

Set DEMO_CACHE=1 to record Google's answers for the replay once and serve them from a file.

Times are minutes since midnight; tracks are [[lat, lng, "HH:MM:SS"], ...].
"""

import math
import threading
import time

import numpy as np

from . import live, routing
from .onboard import LatLng

EVERY_S = 15.0  # one fix per 15 s, like the client's throttle
DETOUR_AT, DETOUR_KM, DETOUR_KMH, DETOUR_DWELL_MIN = 0.4, 1.5, 25.0, 1.0
DETOUR_ANGLE = math.radians(30)  # off the straight line back toward the origin
STOP_AT, STOP_MIN = 0.7, 6.0  # > onboard.STALL_MIN (4), so the stopped flag shows for ~2 min
ARRIVE_DWELL_MIN = 1.5

_replays: dict[str, threading.Event] = {}


def generate_track(origin: LatLng, destination: LatLng, start: float) -> list[list]:
    """A demo track along Google's route, departing at `start`."""
    points, minutes = routing.route_track(origin, destination)
    return build_track(points, minutes, start)


def build_track(
    points: list[LatLng], minutes: list[float], start: float, every_s: float = EVERY_S
) -> list[list]:
    """Insert the detour and the stop into a timed route and resample it every every_s seconds."""
    total = minutes[-1]
    timeline: list[tuple[float, LatLng]] = []
    offset, detoured, stopped = 0.0, False, False
    for p, m in zip(points, minutes, strict=True):
        t = m + offset
        timeline.append((t, p))
        if not detoured and m >= DETOUR_AT * total:
            detoured = True
            excursion, t_end = _detour(p, points[0], t)
            timeline += excursion
            offset += t_end - t
        elif not stopped and m >= STOP_AT * total:
            stopped = True
            timeline.append((t + STOP_MIN, p))
            offset += STOP_MIN
    t_last, end = timeline[-1]
    timeline.append((t_last + ARRIVE_DWELL_MIN, end))

    ts = np.array([t for t, _ in timeline])
    ts = np.maximum.accumulate(ts)  # zero-length steps
    grid = np.arange(0.0, ts[-1] + 1e-9, every_s / 60)
    lat = np.interp(grid, ts, [p[0] for _, p in timeline])
    lng = np.interp(grid, ts, [p[1] for _, p in timeline])
    return [
        [round(a, 6), round(b, 6), _hhmmss(start + g)]
        for a, b, g in zip(lat, lng, grid, strict=True)
    ]


def _detour(p: LatLng, origin: LatLng, t: float) -> tuple[list[tuple[float, LatLng]], float]:
    """Out DETOUR_KM (mostly back toward the origin), dwell, and back to p.

    Returns (timeline, end time).
    """
    dy, dx = _meters(p, origin)
    angle = (math.atan2(dy, dx) if dx or dy else 0.0) + DETOUR_ANGLE
    step_m, n = 100.0, round(DETOUR_KM * 10)
    step_min = step_m / 1000 / DETOUR_KMH * 60
    out = [
        _move(p, k * step_m * math.sin(angle), k * step_m * math.cos(angle))
        for k in range(1, n + 1)
    ]
    timeline = [(t + k * step_min, q) for k, q in enumerate(out, 1)]
    t_far = timeline[-1][0] + DETOUR_DWELL_MIN
    timeline.append((t_far, out[-1]))
    back = [*out[-2::-1], p]
    timeline += [(t_far + k * step_min, q) for k, q in enumerate(back, 1)]
    return timeline, timeline[-1][0]


def _meters(a: LatLng, b: LatLng) -> tuple[float, float]:
    """(north, east) meters from a to b, locally flat."""
    return (b[0] - a[0]) * 111_320, (b[1] - a[1]) * 111_320 * math.cos(math.radians(a[0]))


def _move(p: LatLng, north_m: float, east_m: float) -> LatLng:
    return p[0] + north_m / 111_320, p[1] + east_m / (111_320 * math.cos(math.radians(p[0])))


def _hhmmss(minutes: float) -> str:
    s = round(minutes * 60) % 86400
    return f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}"


def replay(
    trip_id: str,
    track: list,
    speed: float = 10.0,
    sleep=time.sleep,
    stop: threading.Event | None = None,
) -> list[dict]:
    """Send the track as events at speed x real time.

    The first point is a picked_up event unless the rider is already on board.

    Stops early on arrival or when `stop` is set. Returns the status after each event.
    """
    out, prev = [], None
    for i, (lat, lng, t) in enumerate(track):
        if stop is not None and stop.is_set():
            break
        now = live.parse_clock(t)
        if prev is not None:
            sleep(max(now - prev, 0.0) * 60 / speed)
        prev = now
        try:
            if i == 0 and live.get(trip_id).phase == "scheduled":
                out.append(live.handle_event(trip_id, "picked_up", (lat, lng), now))
            else:
                out.append(live.handle_event(trip_id, "gps", (lat, lng), now))
        except live.EventError:
            break
        if out[-1]["phase"] == "arrived":
            break
    return out


def start_replay(trip_id: str, track: list, speed: float) -> None:
    """replay() in a background thread, replacing any replay still running for this trip."""
    if trip_id in _replays:
        _replays[trip_id].set()
    stop = _replays[trip_id] = threading.Event()
    threading.Thread(
        target=replay, args=(trip_id, track, speed), kwargs={"stop": stop}, daemon=True
    ).start()
