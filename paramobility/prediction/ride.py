"""Ride-time model: minutes from boarding to arrival at the destination.

PLACEHOLDER: a Normal around a given expected ride time. To be replaced by a real model
(routing estimate, time of day, shared-ride detours, ...). Keep the interface: return a frozen
scipy distribution of ride minutes.
"""

from scipy import stats

RIDE_SD = 8.0  # ASSUMPTION: minutes


def ride_time(expected_min: float, sd: float = RIDE_SD):
    """Distribution of ride minutes for a trip expected to take `expected_min`."""
    return stats.norm(expected_min, sd)
