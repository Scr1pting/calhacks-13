"""Delay priors and their updates from logged trips."""

from .types import Priors, TripLog


def default_priors() -> Priors:
    """Starting priors before any trips are logged."""
    raise NotImplementedError


def update_priors(priors: Priors, trip_log: list[TripLog]) -> Priors:
    """Fold logged trips into the priors and return the updated priors."""
    raise NotImplementedError
