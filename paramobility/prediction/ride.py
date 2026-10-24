"""Ride-time model: minutes from boarding to arrival at the destination, baked from ride_time_drive.ipynb.

The ride is a shared van, so it takes longer than driving straight there. It scales with the
direct (traffic-aware) drive time for that origin, destination and departure:

    R = OVERHEAD_MIN + KAPPA * T_drive * exp(eta),    eta ~ N(0, S_RIDE^2)

* KAPPA (shared-ride factor) is calibrated so EBP-like trips (sampled near BART stations,
  reweighted to EBP's average 11.43 mi) average EBP's reported 48.9-min ride (EBPAC packet,
  July 7, 2026: Jul '25-Apr '26). It is calibrated on the MEAN, so the lognormal's median is
  mean * exp(-S_RIDE^2 / 2).
* S_RIDE = sqrt(S_RHO^2 + S_EXTRA^2): S_RHO from NYC actual-vs-scheduled ride times
  (data.ny.gov w9xt-anps), S_EXTRA = 0.15 assumed (the van's manifest is unknown in advance).
* Rides are not clipped at the comparable bus-trip time: the ADA rule is a scheduling standard,
  not a physical cap.

Drive times come from routing.drive_minutes. To refit, rerun the notebook and paste
ride_params.json below.
"""

import numpy as np
from scipy import stats

KAPPA = 2.2268947402432  # Google Routes calibration; a bit above the ~1.7-2.2 we expected
S_RIDE = 0.3624913792078372  # SD of log ride time
OVERHEAD_MIN = 0.0  # ASSUMPTION: fixed minutes per ride (boarding, securement); 0 -> pure factor model


def ride_time(drive_min: float):
    """Lognormal ride minutes for a trip whose direct drive takes drive_min. Calibrated on the mean."""
    mean = OVERHEAD_MIN + KAPPA * np.asarray(drive_min, float)
    return stats.lognorm(S_RIDE, scale=mean * np.exp(-(S_RIDE**2) / 2))
