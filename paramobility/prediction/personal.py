"""Personal pickup-lateness model with two levels: rider and recurring trip.

    log(L + C) = mu0(t) + delta_rider + delta_trip[k] + eps
    delta_rider ~ N(0, TAU_R2),  delta_trip[k] ~ N(0, TAU_T2),  eps ~ N(0, SIGMA2)
    TAU_R2 + TAU_T2 + SIGMA2 = S^2   (a rider with no history gets exactly prior.prior(t))

Bayesian linear regression with features x = [1, onehot(trip key)]: the first weight is the rider
offset, the others are per-trip offsets. Older trips are down-weighted by GAMMA per week.
"""

from collections.abc import Hashable, Iterable
from typing import NamedTuple

import numpy as np
from scipy import stats

from prior import C, S, mu0

RIDER_SHARE = 0.10  # ASSUMPTION: variance share that follows the rider everywhere
TRIP_SHARE = 0.10   # ASSUMPTION: extra share specific to one recurring trip
TAU_R2, TAU_T2 = RIDER_SHARE * S**2, TRIP_SHARE * S**2
SIGMA2 = (1 - RIDER_SHARE - TRIP_SHARE) * S**2
GAMMA = 0.9


class Trip(NamedTuple):
    window_start: float   # minutes since midnight
    lateness: float       # observed L, minutes from window start
    day: int
    key: Hashable = None  # recurring-trip id (standing order, or pickup cell + dest cell + hour); None = rider-level only


class Offset(NamedTuple):
    mean: float           # predicted total offset for the requested trip key
    var: float
    rider_mean: float
    trip_mean: float


def offset(history: Iterable[Trip], today: int, key: Hashable = None) -> Offset:
    trips = list(history)
    if not trips:
        return Offset(0.0, TAU_R2 + TAU_T2, 0.0, 0.0)
    keys = sorted({t.key for t in trips if t.key is not None}, key=repr)
    col = {k: i + 1 for i, k in enumerate(keys)}
    n, p = len(trips), len(keys) + 1
    X = np.zeros((n, p)); X[:, 0] = 1
    for i, t in enumerate(trips):
        if t.key is not None:
            X[i, col[t.key]] = 1
    ws = np.array([t.window_start for t in trips], float)
    L = np.array([t.lateness for t in trips], float)
    day = np.array([t.day for t in trips], float)
    r = np.log(np.maximum(L, -C + 0.5) + C) - mu0(ws)
    w = GAMMA ** ((today - day) / 7)
    prior_prec = np.diag([1 / TAU_R2] + [1 / TAU_T2] * len(keys))
    A = prior_prec + (X.T * w) @ X / SIGMA2          # posterior precision (your notes: Sigma^-1)
    cov = np.linalg.inv(A)
    mean = cov @ (X.T @ (w * r)) / SIGMA2             # posterior mean (your notes: mu)
    x = np.zeros(p); x[0] = 1
    if key in col:
        x[col[key]] = 1
    trip_var_new = 0.0 if key in col else TAU_T2      # unseen (or unkeyed) trip: its own offset is still unknown
    return Offset(float(x @ mean), float(x @ cov @ x + trip_var_new),
                  float(mean[0]), float(mean[col[key]]) if key in col else 0.0)


def lateness(window_start, history: Iterable[Trip] = (), today: int = 0, key: Hashable = None):
    d = offset(history, today, key)
    return stats.lognorm(np.sqrt(SIGMA2 + d.var), loc=-C, scale=np.exp(mu0(window_start) + d.mean))
