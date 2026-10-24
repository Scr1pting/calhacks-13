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
    n_vans: int = 275                      # CALIBRATED: smallest fleet with ~no capacity denials
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
    candidate_vans: int = 25               # nearest busy vans tried per trip
    idle_candidates: int = 8               # nearest not-yet-used vans tried per trip

    # ---- Delay model (ASSUMPTIONS) ------------------------------------------
    sigma_offpeak: float = 0.22            # lognormal spread of travel time
    sigma_peak: float = 0.32
    incident_prob: float = 0.03            # per leg: freeway crash, closure, double-parking
    incident_mean_min: float = 9.0
    incident_sigma: float = 1.0            # lognormal spread: most incidents are short, a few close a freeway (CALIBRATED)
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
    # ---- Dispatcher rescue (threshold CALIBRATED, rest ASSUMPTION) ----------
    # When a van leaves a stop, dispatch projects its upcoming pickups; any that would be
    # more than rescue_threshold_min past window goes to a backup vehicle (taxi / spare van).
    rescue_threshold_min: float | None = 30.0   # None disables rescues
    rescue_lookahead_min: float = 90.0          # how far ahead in the plan dispatch looks
    rescue_response_min: float = 30.0           # backup vehicle: decision -> at the door (lognormal mean)
    rescue_availability: float = 0.5            # chance a backup is free when asked (ASSUMPTION; weakly identified)
    dwell_sigma: float = 0.35
    board_mean: tuple = (2.0, 3.5, 6.5)    # ambulatory, walker, wheelchair
    alight_mean: tuple = (1.5, 2.5, 5.0)

    # ---- Travel -------------------------------------------------------------
    road_network: str | None = "data/road_network.npz"  # OSRM road distances; built on first use, None = straight line
    detour_factor: float = 1.30            # road km / straight-line km, for short hops and fallback
    curb_overhead_min: float = 1.0
    freeway_boost: float = 0.8             # long legs use 880/580/80: up to +80% speed
    freeway_km: float = 25.0               # leg length at which the boost saturates
    weekend_speed_factor: float = 1.12
    speed_profile_csv: str | None = None   # optional hour,speed_mph,sigma override

    # ---- Calibration targets --------------------------------------------------
    # Most recent EBP on-time figures: on time 94.7%, 1-20 min past window 4.42%,
    # 21-59 min 0.79%, 60+ min 0.06%
    target_otp: float = 0.947
    target_late_1_20: float = 0.0442
    target_late_21_59: float = 0.0079
    target_late_60_plus: float = 0.0006
    target_denial_rate: float = 0.005      # ADA: capacity denials should be ~0; fleet size is fitted to this
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
