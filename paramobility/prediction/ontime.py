"""P(on time): pickup lateness and ride time combined.

    arrival = window_start + max(L, 0) + R

L comes from personal.lateness (the prior when there is no history; `key` picks a recurring
trip) and R from ride.ride_time, given the direct drive time of the trip. The rider boards at the window start at the earliest.
While a rider is still waiting at `now`, L is conditioned on L > now - window_start.

There is no closed form for the sum, but P(arrival <= x) = E_L[F_R(x - window_start - max(L, 0))]
is a smooth 1-D integral. It is evaluated on m evenly spaced quantiles of L: deterministic, ~1 ms,
~4 decimals. arrival_draws (Monte Carlo) is kept to check it.

Known gaps:
* L and R are independent. A late van may also have a fuller manifest and a longer ride.
* latest_window_start reuses one drive time for every candidate window.
* No personal ride history yet (log of actual ride / drive); it would work like personal.py.

Times are minutes since midnight.
"""

import numpy as np

from personal import Trip, lateness
from prior import SERVICE_START
from ride import ride_time


def arrival_draws(window_start, drive_min, history=(), today=0, now=None, n=40_000, seed=0, key=None):
    """Monte Carlo draws of the arrival time, in minutes since midnight."""
    rng = np.random.default_rng(seed)
    L_dist = lateness(window_start, history, today, key)
    tail = 1.0 if now is None else L_dist.sf(now - window_start)
    L = L_dist.isf(rng.uniform(0.0, tail, n))  # isf keeps precision deep in the tail
    R = ride_time(drive_min).rvs(n, random_state=rng)
    return window_start + np.maximum(L, 0.0) + R


def pickup_quantiles(window_start, history=(), today=0, now=None, m=2000, key=None) -> np.ndarray:
    """max(L, 0) at m evenly spaced quantiles of L, conditioned on L > now - window_start if now is set."""
    d = lateness(window_start, history, today, key)
    tail = 1.0 if now is None else d.sf(now - window_start)  # P(still not picked up)
    u = (np.arange(m) + 0.5) / m
    return np.maximum(d.isf(u * tail), 0.0)  # isf keeps precision deep in the tail


def arrival_cdf(x, window_start, drive_min, history=(), today=0, now=None, key=None) -> np.ndarray:
    """P(arrival <= x), x in minutes since midnight (scalar or array)."""
    L = pickup_quantiles(window_start, history, today, now, key=key)
    x = np.atleast_1d(np.asarray(x, float))
    return ride_time(drive_min).cdf(x[:, None] - window_start - L[None, :]).mean(axis=1)


def p_on_time(appointment, window_start, drive_min, history: tuple[Trip, ...] = (),
              today=0, now=None, key=None) -> float:
    """P(arrival <= appointment)."""
    return float(arrival_cdf(appointment, window_start, drive_min, history, today, now, key)[0])


def evaluate_window(appointment, window_start, drive_min, history=(), today=0,
                    early_min=30.0, quantiles=(0.1, 0.5, 0.9), key=None) -> dict:
    """P(on time), P(more than early_min early) and arrival quantiles relative to the appointment.

    The quantiles invert arrival_cdf on a 1-min grid that covers the arrival's support, from the
    window start to well past the 99.9th percentiles of pickup and ride.
    """
    L = lateness(window_start, history, today, key)
    hi = window_start + max(L.ppf(0.999), 0.0) + ride_time(drive_min).ppf(0.999)
    grid = np.arange(window_start, np.ceil(hi) + 1.0)
    cdf = arrival_cdf(grid, window_start, drive_min, history, today, key=key)
    return {
        "p_on_time": p_on_time(appointment, window_start, drive_min, history, today, key=key),
        "p_very_early": float(arrival_cdf(appointment - early_min, window_start, drive_min,
                                          history, today, key=key)[0]),
        "arrival_vs_appointment": {q: float(np.interp(q, cdf, grid) - appointment) for q in quantiles},
    }


def latest_window_start(appointment, drive_min, history=(), today=0, target=0.95,
                        step=5, max_back=240, key=None) -> float | None:
    """Latest window start on the clock's step-minute grid with P(on time) >= target.

    Scans back from the last grid time before the appointment and returns the first that
    qualifies, so a later grid time never does. p_on_time is not strictly monotone in the window
    start (the prior varies by hour), which is why this scans instead of bisecting. Windows
    before 05:00 have no service; returns None if nothing qualifies within max_back minutes.
    The same drive_min is used for every candidate (an approximation: traffic changes too).
    """
    latest = (np.ceil(appointment / step) - 1) * step
    earliest = max(appointment - max_back, SERVICE_START)
    for w in np.arange(latest, earliest - 1e-9, -step):
        if p_on_time(appointment, w, drive_min, history, today, key=key) >= target:
            return float(w)
    return None
