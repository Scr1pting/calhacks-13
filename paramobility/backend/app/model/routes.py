"""Drive time estimates between two points."""

from datetime import datetime, timedelta


def drive_time(
    origin: str, dest: str, depart: datetime
) -> tuple[timedelta, timedelta, timedelta]:
    """Return (optimistic, best_guess, pessimistic) drive time for a departure."""
    raise NotImplementedError
