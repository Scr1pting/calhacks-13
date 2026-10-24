"""A trip in datetimes: candidate pickup windows, their scores, and the live outlook.

ontime works in minutes since midnight. This module maps a trip onto it: clock minutes are LA
time (routing.TZ), which is what prior.mu0 expects, and every other time is taken relative to the
window start, so trips across midnight line up. Datetimes must be aware (see aware()).

A window start is the start of EBP's 30-min pickup window (what the rider books), on the clock's
STEP-minute grid. The drive time for a window is looked up for boarding BOARD_AFTER_START minutes
into it. No personal history yet: every rider gets the prior.
"""

import math
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import NamedTuple

import numpy as np

from . import ontime, routing
from .prior import SERVICE_START, C
from .ride import ride_time

STEP = 5  # minutes between candidate window starts
MAX_BACK = 240  # minutes: the earliest candidate window starts this long before the appointment
BOARD_AFTER_START = 15.0  # minutes: drive time is looked up for a typical boarding time


class ModelUnavailable(RuntimeError):
    """The model can't answer for this trip: no route, or no service at that time."""


class Ride(NamedTuple):
    origin: str  # addresses, geocoded on use
    dest: str
    arrive_by: datetime  # the appointment
    deadline: datetime  # arrive_by plus the appointment's grace period


class Score(NamedTuple):
    window_start: datetime
    p_on_time: float  # P(arrival <= deadline)
    expected_wait_min: float  # mean minutes early for arrive_by, late arrivals counted as zero


def aware(t: datetime) -> datetime:
    """t with a time zone: a naive datetime is taken as LA time."""
    return t.replace(tzinfo=routing.TZ) if t.tzinfo is None else t


def clock(t: datetime) -> float:
    """Minutes since midnight, LA time."""
    t = t.astimezone(routing.TZ)
    return t.hour * 60 + t.minute + t.second / 60


def minutes(td: timedelta) -> float:
    return td.total_seconds() / 60


def drive_minutes(ride: Ride, depart: datetime) -> float:
    """Direct drive minutes for the trip, leaving at depart."""
    try:
        origin, dest = routing.geocode(ride.origin), routing.geocode(ride.dest)
        return routing.drive_minutes(origin, dest, depart)
    except routing.RoutingError as e:
        raise ModelUnavailable(f"no drive time for this trip: {e}") from e


def windows(ride: Ride) -> list[datetime]:
    """Candidate window starts, earliest first: on the STEP grid, before arrive_by, from 05:00."""
    # LA's UTC offset is whole hours, so the grid is the same in epoch minutes.
    end = ride.arrive_by.timestamp() / 60
    latest = (math.ceil(end / STEP) - 1) * STEP
    starts = [
        datetime.fromtimestamp(m * 60, UTC).astimezone(ride.arrive_by.tzinfo)
        for m in range(latest, math.floor(end - MAX_BACK) - 1, -STEP)
    ]
    return [w for w in reversed(starts) if clock(w) >= SERVICE_START]


def score(ride: Ride, window_start: datetime) -> Score:
    w = _service_clock(window_start)
    drive = drive_minutes(ride, window_start + timedelta(minutes=BOARD_AFTER_START))
    deadline = w + minutes(ride.deadline - window_start)
    arrive_by = w + minutes(ride.arrive_by - window_start)
    p = ontime.p_on_time(deadline, w, drive)
    # E[max(arrive_by - arrival, 0)] = integral of P(arrival <= x) up to arrive_by; the van is at
    # most C min early, so the arrival is never before w - C.
    first = w - C
    wait = 0.0
    if arrive_by > first:
        grid = np.linspace(first, arrive_by, math.ceil(arrive_by - first) + 1)
        wait = float(np.trapezoid(ontime.arrival_cdf(grid, w, drive), grid))
    return Score(window_start, p, wait)


@lru_cache(maxsize=256)
def tradeoff(ride: Ride) -> tuple[Score, ...]:
    """Every candidate window, earliest first. Cached: a plan asks for the same trip often."""
    return tuple(score(ride, w) for w in windows(ride))


def options(ride: Ride, certainty: float, n: int = 3) -> list[Score]:
    """The n latest windows (least waiting) that reach the certainty, latest first."""
    ok = [s for s in tradeoff(ride) if s.p_on_time >= certainty]
    return ok[::-1][:n]


def histogram(ride: Ride, window_start: datetime, bin_min: int = STEP) -> tuple[list, list]:
    """(bin edges, P(arrival in each bin)), from the earliest pickup to the 99.9th percentile."""
    w = _service_clock(window_start)
    drive = drive_minutes(ride, window_start + timedelta(minutes=BOARD_AFTER_START))
    hi = ontime.pickup_quantiles(w).max() + ride_time(drive).ppf(0.999)
    edges = np.arange(-math.ceil(C / bin_min) * bin_min, hi + bin_min, bin_min)  # after w
    p = np.diff(ontime.arrival_cdf(w + edges, w, drive))
    return [window_start + timedelta(minutes=float(e)) for e in edges], p.tolist()


def outlook(
    ride: Ride,
    window_start: datetime,
    at: datetime,
    van_eta: datetime | None = None,
    picked_up_at: datetime | None = None,
) -> tuple[float, datetime]:
    """(P(arrival <= deadline), median arrival) for a booked window, given what is known at `at`.

    * Waiting: the pickup lateness is conditioned on the van not having come by `at`.
    * Van ETA known: boarding at the ETA, or at `at` if the van is already past it.
    * Picked up: only the ride is uncertain, conditioned on it lasting past `at`.
    """
    w = _service_clock(window_start)
    deadline = minutes(ride.deadline - window_start)
    now = minutes(at - window_start)
    if picked_up_at is None and van_eta is None:
        drive = drive_minutes(ride, window_start + timedelta(minutes=BOARD_AFTER_START))
        p = ontime.p_on_time(w + deadline, w, drive, now=w + now)
        appointment = w + minutes(ride.arrive_by - window_start)
        ev = ontime.evaluate_window(appointment, w, drive, quantiles=(0.5,), now=w + now)
        return p, ride.arrive_by + timedelta(minutes=ev["arrival_vs_appointment"][0.5])

    boarding = minutes((picked_up_at or van_eta) - window_start)
    if picked_up_at is None:
        boarding = max(boarding, now)  # the van is late for its own ETA
    ridden = max(now - boarding, 0.0) if picked_up_at else 0.0
    R = ride_time(drive_minutes(ride, window_start + timedelta(minutes=boarding)))
    left = R.sf(ridden)
    if left <= 0:  # far past any plausible ride
        return 0.0, at
    p = max(R.cdf(deadline - boarding) - R.cdf(ridden), 0.0) / left
    median = boarding + R.isf(0.5 * left)
    return float(p), window_start + timedelta(minutes=float(median))


def _service_clock(window_start: datetime) -> float:
    w = clock(window_start)
    if w < SERVICE_START:
        raise ModelUnavailable("no paratransit service before 05:00")
    return w
