"""Glue: generate -> schedule -> execute, and summary stats."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import SimConfig
from .delays import execute_day
from .demand import generate_day, generate_riders
from .geo import TravelModel
from .scheduler import plan_table, schedule_day

KM_PER_MILE = 1.609344


@dataclass
class DayResult:
    day: int
    trips: pd.DataFrame
    plan: pd.DataFrame
    executed: pd.DataFrame
    vans: list


class World:
    def __init__(self, cfg: SimConfig):
        self.cfg = cfg
        self.travel = TravelModel(cfg)
        self.riders = generate_riders(cfg, np.random.default_rng(cfg.seed))

    def simulate_day(self, day: int, seed_offset: int = 0) -> DayResult:
        rng = np.random.default_rng([self.cfg.seed, day, seed_offset])
        trips = generate_day(day, self.riders, self.cfg, self.travel, rng)
        vans, trips = schedule_day(trips, self.cfg, self.travel, rng)
        plan = plan_table(vans, trips)
        ex = execute_day(vans, trips, plan, self.cfg, self.travel, rng)
        # attach outcome to each trip
        p = ex[ex["kind"] == "P"].set_index("trip_id")
        d = ex[ex["kind"] == "D"].set_index("trip_id")
        trips = trips.copy()
        trips["actual_pickup"] = trips["trip_id"].map(p["arr_eff"])
        trips["actual_dropoff"] = trips["trip_id"].map(d["arr"])
        trips["pickup_status"] = trips["trip_id"].map(p["status"])
        trips["late_past_window"] = trips["trip_id"].map(p["late_past_window"])
        trips["ride_min"] = trips["actual_dropoff"] - trips["trip_id"].map(p["dep"])
        return DayResult(day, trips, plan, ex, vans)


def summarize(results: list[DayResult]) -> dict:
    ex = pd.concat([r.executed.assign(day=r.day) for r in results])
    tr = pd.concat([r.trips for r in results])
    p = ex[ex["kind"] == "P"]
    served = tr[~tr["denied"] & (tr["pickup_status"] == "ok")]
    hour = (p["promised"] // 60).astype(int)
    L = p["late_past_window"]
    return dict(
        days=len(results),
        trips=int(len(tr)),
        denial_rate=float(tr["denied"].mean()),
        otp=float(p["on_time"].mean()),
        late_1_20=float(((L > 0) & (L <= 20)).mean()),
        late_21_59=float(((L > 20) & (L < 60)).mean()),
        late_60_plus=float((L >= 60).mean()),
        rescue_rate=float((p["status"] == "rescued").mean()),
        no_show_rate=float(p["status"].str.startswith("no_show").mean()),
        mean_minutes_past_window_when_late=float(p.loc[p["on_time"] == 0, "late_past_window"].mean()),
        avg_trip_miles=float(served["direct_km"].mean() / KM_PER_MILE),
        # comparable to EBP's "revenue miles per ADA passenger": van miles between
        # stops (excluding the first deadhead leg from the yard) per rider carried
        revenue_miles_per_passenger=float(ex.loc[ex["seq"] > 0, "km"].sum() / KM_PER_MILE
                                          / max(1, int((p["status"] == "ok").sum()))),
        avg_ride_minutes=float(served["ride_min"].mean()),
        # comparable to EBP's "minutes per ADA passenger": van in-service time per rider carried
        revenue_minutes_per_passenger=float(
            ex.groupby(["day", "van_id"])
              .apply(lambda g: g["dep"].max() - g["arr"].min(), include_groups=False).sum()
            / max(1, int((p["status"] == "ok").sum()))),
        otp_by_hour={int(h): round(float(v), 3) for h, v in p.groupby(hour)["on_time"].mean().items()},
    )
