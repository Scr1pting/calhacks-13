"""Turn simulations into booking recommendations."""

from datetime import datetime, timedelta

from .types import Trip, TripOption


def options(trip: Trip, certainty: float) -> list[TripOption]:
    """Best pickup times that reach the requested certainty of arriving on time."""
    raise NotImplementedError


def tradeoff(trip: Trip) -> list[tuple[datetime, float, timedelta]]:
    """(pickup_time, p_on_time, expected_wait) across candidate pickup times."""
    raise NotImplementedError
