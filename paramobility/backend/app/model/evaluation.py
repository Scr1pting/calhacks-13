"""Model inspection and calibration, for the dashboard."""

from datetime import datetime

from .types import Distribution, Trip, TripLog


def distribution(trip: Trip, pickup_time: datetime) -> Distribution:
    """Arrival histogram and its components for one pickup time."""
    raise NotImplementedError


def calibration(logs: list[TripLog]) -> list[tuple[float, float]]:
    """(promised, observed) on-time rates, grouped by promised certainty."""
    raise NotImplementedError
