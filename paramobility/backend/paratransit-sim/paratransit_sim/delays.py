"""The stochastic world: runs each van's planned route with realistic delays.

Each executed stop records WHY it ran late, so the output doubles as a labeled
delay dataset: traffic noise, incidents, hard-to-find addresses, riders not
ready, boarding time, breakdowns, and late shift starts. Cascading lateness
emerges because every stop starts when the previous one ends.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .config import SimConfig
from .geo import TravelModel


def _lognormal_mean(rng, mean, sigma):
    return float(rng.lognormal(math.log(mean) - sigma ** 2 / 2, sigma))


def execute_day(vans, trips: pd.DataFrame, plan: pd.DataFrame, cfg: SimConfig,
                travel: TravelModel, rng: np.random.Generator) -> pd.DataFrame:
    weekend = bool(trips["dow"].iloc[0] >= 5)
    rows = []
    for van_id, g in plan.groupby("van_id", sort=True):
        van = vans[van_id]
        g = g.sort_values("seq")
        late_start = rng.uniform(cfg.late_shift_min, cfg.late_shift_max) if rng.random() < cfg.late_shift_prob else 0.0
        t = van.start + late_start
        lat, lon = van.lat0, van.lon0
        breakdown_at = int(rng.integers(len(g))) if rng.random() < cfg.breakdown_prob_per_van_day else -1
        noshow = set()
        rescued = {}  # ti -> dispatcher decision time
        no_backup = set()  # dispatch asked, no backup was free; the van keeps the trip
        prev_plan_dep = van.start
        stops = list(g.itertuples(index=False))
        for k, s in enumerate(stops):
            row = dict(van_id=van_id, depot=s.depot, seq=s.seq, kind=s.kind, trip_id=s.trip_id, ti=s.ti,
                       lat=s.lat, lon=s.lon, mobility=s.mobility, promised=s.promised,
                       plan_arr=s.plan_arr, plan_dep=s.plan_dep,
                       depart_prev=t, prev_lat=lat, prev_lon=lon,
                       inherited_behind_min=t - prev_plan_dep,   # lateness carried in from earlier stops
                       late_start_min=late_start if k == 0 else 0.0)
            if s.kind == "D" and (s.ti in noshow or s.ti in rescued):
                rows.append(dict(row, status="skipped", arr=np.nan, arr_eff=np.nan, dep=t))
                continue
            if s.kind == "P" and s.ti in rescued:
                arr = rescued[s.ti] + _lognormal_mean(rng, cfg.rescue_response_min, 0.3)
                rows.append(dict(row, status="rescued", arr=arr, arr_eff=max(arr, s.promised), dep=t))
                continue
            km = float(travel.road_km(lat, lon, s.lat, s.lon))
            med = travel.median_scalar(km, t, weekend)
            traffic = med * float(rng.lognormal(0.0, float(travel.sigma(t))))
            incident = rng.exponential(cfg.incident_mean_min) if rng.random() < cfg.incident_prob else 0.0
            hard_addr = rng.uniform(cfg.hard_address_min, cfg.hard_address_max) if rng.random() < cfg.hard_address_prob else 0.0
            arr = t + traffic + incident + hard_addr
            status, rider_wait, idle_wait = "ok", 0.0, 0.0
            if s.kind == "P":
                arr_eff = max(arr, s.promised)            # early van waits for the window to open
                idle_wait = arr_eff - arr
                if rng.random() < cfg.not_ready_prob:
                    rider_wait = float(rng.exponential(cfg.not_ready_mean_min))
                if rider_wait > cfg.no_show_wait_min:
                    status, rider_wait = "no_show", cfg.no_show_wait_min
                    noshow.add(s.ti)
                    dwell = 0.0
                else:
                    dwell = _lognormal_mean(rng, cfg.board_mean[s.mobility], cfg.dwell_sigma)
                dep = arr_eff + rider_wait + dwell
            else:
                arr_eff = arr
                dwell = _lognormal_mean(rng, cfg.alight_mean[s.mobility], cfg.dwell_sigma)
                dep = arr + dwell
            breakdown = 0.0
            if k == breakdown_at:
                breakdown = rng.uniform(cfg.breakdown_min, cfg.breakdown_max)
                dep += breakdown
                status += "+breakdown"
            rows.append(dict(row, status=status, km=km, travel_median_min=med,
                             travel_planned_min=med * cfg.plan_factor, travel_actual_min=traffic,
                             incident_min=incident, hard_address_min=hard_addr,
                             idle_wait_min=idle_wait, rider_not_ready_min=rider_wait,
                             dwell_min=dwell, breakdown_min=breakdown,
                             arr=arr, arr_eff=arr_eff, dep=dep))
            t, lat, lon, prev_plan_dep = dep, s.lat, s.lon, s.plan_dep
            behind = t - s.plan_dep
            if cfg.rescue_threshold_min is not None and behind > 0:
                for s2 in stops[k + 1:]:
                    if s2.plan_arr - s.plan_dep > cfg.rescue_lookahead_min:
                        break
                    van_eta = s2.plan_arr + behind
                    if (s2.kind == "P" and s2.ti not in rescued and s2.ti not in noshow and s2.ti not in no_backup
                            and van_eta - s2.promised - cfg.window_min > cfg.rescue_threshold_min
                            and t + cfg.rescue_response_min < van_eta):  # only if the backup gets there first
                        if rng.random() < cfg.rescue_availability:
                            rescued[s2.ti] = t
                        else:
                            no_backup.add(s2.ti)
    ex = pd.DataFrame(rows)
    p = ex["kind"] == "P"
    ex["late_vs_window_start"] = np.where(p, ex["arr_eff"] - ex["promised"], np.nan)
    ex["late_past_window"] = np.where(p, np.maximum(0.0, ex["arr_eff"] - ex["promised"] - cfg.window_min), np.nan)
    ex["on_time"] = np.where(p, ex["late_vs_window_start"] <= cfg.window_min, np.nan)
    ex["behind_plan_min"] = ex["arr"] - ex["plan_arr"]
    return ex
