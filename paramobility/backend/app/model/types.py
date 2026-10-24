"""Shared types for the delay model."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

# Simulated door-to-door arrival times for one booking.
Samples = list[datetime]


@dataclass
class Trip:
    origin: str
    dest: str
    arrive_by: datetime  # appointment time
    grace: timedelta = timedelta(0)  # how late the appointment tolerates

    @property
    def deadline(self) -> datetime:
        return self.arrive_by + self.grace


@dataclass
class Priors:
    """Delay distribution parameters, refined as riders log real trips."""

    pickup_lateness: dict = field(default_factory=dict)  # van late vs booked pickup
    traffic: dict = field(default_factory=dict)  # spread around best_guess drive time
    detour: dict = field(default_factory=dict)  # extra time from shared rides
    n_trips: int = 0  # number of logged trips folded in


@dataclass
class TripLog:
    trip: Trip
    booked_pickup: datetime
    actual_pickup: datetime
    actual_arrival: datetime
    promised_p_on_time: float  # what we told the rider at booking


@dataclass
class TripOption:
    pickup_time: datetime
    p_on_time: float
    expected_wait: timedelta


@dataclass
class Distribution:
    """Arrival histogram plus the per-component breakdown, for the dashboard."""

    bin_edges: list[datetime]
    counts: list[int]
    components: dict[str, list[timedelta]]  # e.g. pickup_lateness, drive, detour
