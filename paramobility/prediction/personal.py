"""Personal pickup-lateness model: Bayesian linear regression on top of the time-of-day prior.

A rider's trips share an offset delta in log space:

    log(L + C) = mu0(t) + delta + eps,    delta ~ N(0, tau^2),    eps ~ N(0, sigma^2)

with tau^2 + sigma^2 = S^2, so a rider without history gets exactly prior.prior(t). The design
is intercept-only, so the posterior of delta is the conjugate Gaussian update on the residuals
log(L + C) - mu0(t). Older trips are down-weighted by GAMMA per week (their noise variance is
inflated by 1 / weight).

Times are minutes since midnight; days are integer day indices (any origin).
"""

from collections.abc import Iterable
from typing import NamedTuple

import numpy as np
from scipy import stats

from prior import C, S, mu0

PERSONAL_SHARE = 0.2  # ASSUMPTION: share of the prior variance that is rider-specific
TAU2 = PERSONAL_SHARE * S**2  # prior variance of delta
SIGMA2 = (1 - PERSONAL_SHARE) * S**2  # per-trip noise variance
GAMMA = 0.9  # weekly decay: last week counts 1.0, 10 weeks ago ~0.35


class Trip(NamedTuple):
    window_start: float  # minutes since midnight
    lateness: float  # observed L, minutes from window start
    day: int


class Offset(NamedTuple):
    mean: float
    var: float


def offset(history: Iterable[Trip], today: int) -> Offset:
    """Posterior of the rider's offset delta given past trips."""
    trips = list(history)
    if not trips:
        return Offset(0.0, TAU2)
    ws, L, day = (np.array(x, float) for x in zip(*trips, strict=True))
    r = np.log(np.maximum(L, -C + 0.5) + C) - mu0(ws)  # residuals vs the time-of-day prior
    w = GAMMA ** ((today - day) / 7)
    prec = 1 / TAU2 + w.sum() / SIGMA2
    return Offset(float(w @ r / SIGMA2 / prec), float(1 / prec))


def lateness(window_start, history: Iterable[Trip] = (), today: int = 0):
    """Posterior predictive of L for this rider: a frozen scipy lognorm, like prior.prior."""
    d = offset(history, today)
    return stats.lognorm(np.sqrt(SIGMA2 + d.var), loc=-C, scale=np.exp(mu0(window_start) + d.mean))
