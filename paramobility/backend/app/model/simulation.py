"""Monte Carlo simulation of arrival times."""

from datetime import datetime, timedelta

from .types import Priors, Samples, Trip


def simulate_arrivals(
    trip: Trip, pickup_time: datetime, priors: Priors, n: int
) -> Samples:
    """Sample n arrival times: pickup lateness + traffic + shared-ride detours."""
    raise NotImplementedError


def p_on_time(samples: Samples, deadline: datetime) -> float:
    """Fraction of samples arriving at or before the deadline."""
    raise NotImplementedError


def expected_wait(samples: Samples, arrive_by: datetime) -> timedelta:
    """Mean time spent waiting before arrive_by, counting late arrivals as zero."""
    raise NotImplementedError
