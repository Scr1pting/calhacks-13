"""Time-of-day prior for EBP pickup lateness, baked from prior_ny_smooth.ipynb.

L = minutes from the start of the 30-min pickup window to the van's arrival. The prior is a
shifted lognormal, log(L + C) ~ N(mu0(t), S^2), where t is the window start.

* The hour-of-day shape comes from NYC Access-A-Ride pickup OTP (data.ny.gov dqvw-iu8s,
  2024-present): one lognormal per hour, joined by a periodic cubic spline through the bin centres.
* The level and spread are calibrated to EBP's own buckets (Jul '25-Apr '26, 369,241 ADA trips:
  94.7% on time, 4.42% 1-20, 0.79% 21-59, 0.06% 60+ min past the window).
* C = 5 (vans can arrive ~5 min early) is assumed; the data can't identify it.

L can be negative (the van is early). A rider boards at the window start at the earliest, so
boarding lateness is max(L, 0).

To refit, rerun the notebook and paste mu0(CENTERS) and s into _MU0_HOURLY and S.

Times are minutes since midnight and wrap at 24 h. Every function accepts scalars or arrays.
Windows starting 00:00-04:59 raise ValueError: only All Nighter buses run then, and EBP only
serves trips with bus/BART service nearby.
"""

from __future__ import annotations

import numpy as np
from scipy import stats
from scipy.interpolate import CubicSpline

C = 5.0  # shift: log(L + C) is Gaussian
S = 0.588057  # SD of log(L + C)
WINDOW = 30.0  # minutes; picked up after the window <=> L > WINDOW
SERVICE_START = 5 * 60.0  # minutes after midnight; no regular service before this

# mu0 at the hourly bin centres 00:30, 01:30, ..., 23:30
_MU0_HOURLY = np.array([
    2.885107, 2.729050, 2.590367, 2.527051, 2.527132, 2.477271,
    2.510493, 2.571500, 2.640598, 2.587165, 2.513105, 2.467884,
    2.534939, 2.616885, 2.648478, 2.690708, 2.704454, 2.729813,
    2.618408, 2.486332, 2.491268, 2.575675, 2.710802, 2.798203,
])  # fmt: skip

_CENTERS = (np.arange(24) + 0.5) * 60.0
_spline = CubicSpline(
    np.r_[_CENTERS, _CENTERS[0] + 1440.0], np.r_[_MU0_HOURLY, _MU0_HOURLY[0]], bc_type="periodic"
)


def mu0(minutes):
    """Prior mean of log(L + C) for a window starting `minutes` after midnight."""
    t = np.asarray(minutes, float) % 1440.0
    if np.any(t < SERVICE_START):
        raise ValueError(f"no service before 05:00: window start(s) {t[t < SERVICE_START]} min")
    return _spline(t)


def prior(minutes):
    """Frozen scipy distribution of L (minutes from window start) for a window starting at `minutes`.

    Use .pdf, .cdf, .sf, .ppf, .interval, .rvs, etc. An array of times gives a batch of distributions.
    """
    return stats.lognorm(S, loc=-C, scale=np.exp(mu0(minutes)))


def p_late(minutes, after=WINDOW):
    """P(L > after): by default, the chance of a pickup after the window ends."""
    return stats.norm.sf((np.log(after + C) - mu0(minutes)) / S)
