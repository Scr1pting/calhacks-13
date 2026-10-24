"""All tunable parameters in one place.

Every number is either (a) from a public East Bay Paratransit (EBP) source,
noted as such, or (b) an ASSUMPTION that calibration or your team can tune.
Pitch line: "trips are simulated; delay behaviour is calibrated to East Bay
Paratransit's published on-time performance."
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass

MOBILITY = ("ambulatory", "walker", "wheelchair")


@dataclass
class SimConfig:
    seed: int = 7

    # ---- Demand --------------------------------------------------------------
    # EBP ops report (Dec 2019): ~2,600 avg weekday passengers, ~700 weekend.
    trips_per_weekday: int = 2400          # one-way rider trips (excl. companions)
    saturday_factor: float = 0.29
    sunday_factor: float = 0.29
    rider_pool: int = 7000                 # ASSUMPTION

    # ---- Fleet (ASSUMPTION: EBP does not publish fleet size in the report) ---
    n_vans: int = 215
    shift_hours: float = 10.0
    # Synthetic yards in the areas where contractors operate (approximate)
    depots: tuple = (("Oakland yard", 37.7700, -122.2050, 0.5),
                     ("Hayward yard", 37.6450, -122.1100, 0.3),
                     ("Richmond yard", 37.9300, -122.3600, 0.2))

    # ---- Agency rules (EBP, public) -----------------------------------------
    # 30-minute pickup window; be ready when it opens; driver waits 5 minutes.
    window_min: float = 30.0
    no_show_wait_min: float = 5.0
    max_negotiation_min: float = 60.0      # ADA allows +/- 1 hour negotiation

    # ---- Scheduler (CALIBRATED) ---------------------------------------------
    plan_factor: float = 1.05              # planned travel = median * plan_factor
    plan_into_window_min: float = 10.0     # planner aims to arrive within first N min of window
    plan_dwell_factor: float = 0.85        # planners under-estimate boarding a little
    tail_positions: int = 7
    candidate_vans: int = 10

    # ---- Delay model (ASSUMPTIONS) ------------------------------------------
    sigma_offpeak: float = 0.22            # lognormal spread of travel time
    sigma_peak: float = 0.32
    incident_prob: float = 0.03            # per leg: freeway crash, closure, double-parking
    incident_mean_min: float = 9.0
    late_shift_prob: float = 0.08
    late_shift_min: float = 5.0
    late_shift_max: float = 20.0
    breakdown_prob_per_van_day: float = 0.01
    breakdown_min: float = 30.0
    breakdown_max: float = 60.0
    not_ready_prob: float = 0.12           # rider not at the door
    not_ready_mean_min: float = 3.0        # exponential; > 5 min -> no-show (EBP ~2.6-3.1%)
    hard_address_prob: float = 0.03
    hard_address_min: float = 2.0
    hard_address_max: float = 7.0
    dwell_sigma: float = 0.35
    board_mean: tuple = (2.0, 3.5, 6.5)    # ambulatory, walker, wheelchair
    alight_mean: tuple = (1.5, 2.5, 5.0)

    # ---- Travel -------------------------------------------------------------
    detour_factor: float = 1.30            # road km / straight-line km
    curb_overhead_min: float = 1.0
    freeway_boost: float = 0.8             # long legs use 880/580/80: up to +80% speed
    freeway_km: float = 25.0               # leg length at which the boost saturates
    weekend_speed_factor: float = 1.12
    speed_profile_csv: str | None = None   # optional hour,speed_mph,sigma override

    # ---- Calibration targets (EBP ops report Dec 2019) -----------------------
    target_otp: float = 0.879              # FY year-to-date; agency standard is >= 91%
    ref_miles_per_passenger: float = 9.8   # revenue miles per ADA passenger (check only)
    ref_minutes_per_passenger: float = 42.0  # van revenue minutes per ADA passenger (check only)

    def save(self, path: str) -> None:
        with open(path, "w") as f:
            json.dump(asdict(self), f, indent=2)

    @classmethod
    def load(cls, path: str) -> "SimConfig":
        with open(path) as f:
            d = json.load(f)
        for k in ("board_mean", "alight_mean"):
            d[k] = tuple(d[k])
        d["depots"] = tuple(tuple(x) for x in d["depots"])
        return cls(**d)
