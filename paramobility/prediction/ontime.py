"""P(on time): pickup lateness and ride time combined.

    arrival = window_start + max(L, 0) + R

L comes from personal.lateness (the prior when there is no history) and R from ride.ride_time.
The rider boards at the window start at the earliest. While a rider is still waiting at `now`,
L is conditioned on L > now - window_start; the draws come from the truncated distribution by
inverse CDF, so deep in the tail they don't run out the way rejection sampling would.

Times are minutes since midnight.
"""

import numpy as np

from personal import Trip, lateness
from ride import ride_time


def arrival_draws(window_start, expected_ride_min, history=(), today=0, now=None, n=40_000, seed=0):
    """Monte Carlo draws of the arrival time, in minutes since midnight."""
    rng = np.random.default_rng(seed)
    L_dist = lateness(window_start, history, today)
    lo = 0.0 if now is None else L_dist.cdf(now - window_start)
    L = L_dist.ppf(rng.uniform(lo, 1.0, n))
    R = ride_time(expected_ride_min).rvs(n, random_state=rng)
    return window_start + np.maximum(L, 0.0) + R


def p_on_time(appointment, window_start, expected_ride_min, history: tuple[Trip, ...] = (),
              today=0, now=None, **kw):
    """P(arrival <= appointment)."""
    t = arrival_draws(window_start, expected_ride_min, history, today, now, **kw)
    return float(np.mean(t <= appointment))
