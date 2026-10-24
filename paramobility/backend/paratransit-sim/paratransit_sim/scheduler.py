"""Greedy insertion scheduler, a stand-in for the agency's scheduling software.

Trips are taken in order of requested time and inserted into the van route that
adds the least time, subject to:
  * the van reaches each pickup within the first `plan_into_window_min` minutes
    of its 30-minute window (using PLANNED travel times),
  * the window start ("promised time") stays within +/- 60 min of the request,
  * maximum ride time, appointment deadlines, and the van's shift.

Planned travel times use `plan_factor`; calibration tunes it so that the
stochastic world reproduces East Bay Paratransit's on-time performance.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .config import SimConfig
from .geo import TravelModel, km_scalar


class Stop:
    __slots__ = ("kind", "ti", "lat", "lon", "promised", "dwell", "arr", "dep", "mob")

    def __init__(self, kind, ti, lat, lon, dwell, mob, promised=math.nan):
        self.kind, self.ti, self.lat, self.lon = kind, ti, lat, lon
        self.dwell, self.mob, self.promised = dwell, mob, promised
        self.arr = self.dep = math.nan


class Van:
    def __init__(self, vid, depot, start, end, lat, lon):
        self.vid, self.depot, self.start, self.end = vid, depot, start, end
        self.lat0, self.lon0 = lat, lon
        self.stops: list[Stop] = []
        self.pick_dep: dict[int, float] = {}


class TripArrays:
    """Plain lists of trip columns for fast scalar access in the hot loop."""

    def __init__(self, trips: pd.DataFrame, travel: TravelModel, cfg: SimConfig, weekend: bool):
        self.req = trips["requested"].tolist()
        out = (trips["leg"] == "out").tolist()
        # outbound trips may be offered earlier; return trips can't start before the appointment ends
        self.neg_lo = [r - (cfg.max_negotiation_min if o else 0.0) for r, o in zip(self.req, out)]
        self.neg_hi = [r + cfg.max_negotiation_min for r in self.req]
        self.appt = trips["appointment"].tolist()
        self.max_ride = [30.0 + 1.8 * travel.median_scalar(km, r, weekend)
                         for km, r in zip(trips["direct_km"], self.req)]


class Scheduler:
    def __init__(self, cfg: SimConfig, travel: TravelModel, weekend: bool):
        self.cfg, self.travel, self.weekend = cfg, travel, weekend

    def plan_tt(self, km, t):
        return self.travel.median_scalar(km, t, self.weekend) * self.cfg.plan_factor

    def _simulate(self, van: Van, i0: int, seq: list[Stop], new_ti: int, ta: TripArrays):
        """Planned times along seq (starting after stop i0-1). None if infeasible."""
        cfg = self.cfg
        into = cfg.plan_into_window_min
        if i0 == 0:
            t, lat, lon = van.start, van.lat0, van.lon0
        else:
            prev = van.stops[i0 - 1]
            t, lat, lon = prev.dep, prev.lat, prev.lon
        pick_dep = {}
        promised_new = math.nan
        times = []
        for s in seq:
            arr = t + self.plan_tt(self.travel.road_km(lat, lon, s.lat, s.lon), t)
            if s.kind == "P":
                if s.ti == new_ti:
                    p = max(ta.neg_lo[s.ti], math.ceil((arr - into) / 5.0) * 5.0)
                    if p > ta.neg_hi[s.ti]:
                        return None
                    promised_new = p
                else:
                    p = s.promised
                    if arr > p + into:
                        return None
                dep = max(arr, p) + s.dwell       # van waits if it is early
                pick_dep[s.ti] = dep
            else:
                pdep = pick_dep.get(s.ti, van.pick_dep.get(s.ti))
                if arr - pdep > ta.max_ride[s.ti]:
                    return None
                appt = ta.appt[s.ti]
                if appt == appt and arr > appt:     # appt is not NaN
                    return None
                dep = arr + s.dwell
            if dep > van.end:
                return None
            times.append((arr, dep))
            t, lat, lon = dep, s.lat, s.lon
        return t, promised_new, times

    def best_insertion(self, van: Van, ti: int, ta: TripArrays, P: Stop, D: Stop):
        n = len(van.stops)
        i0 = max(0, n - self.cfg.tail_positions)
        old_end = van.stops[-1].dep if n else van.start
        tail = van.stops[i0:]
        best = None
        for i in range(i0, n + 1):
            pre = tail[: i - i0]
            if pre and pre[-1].dep > ta.neg_hi[ti] + self.cfg.window_min:
                break
            for j in range(i, n + 1):
                seq = pre + [P] + tail[i - i0: j - i0] + [D] + tail[j - i0:]
                res = self._simulate(van, i0, seq, ti, ta)
                if res is None:
                    continue
                end, p, times = res
                cost = (end - old_end) + 0.5 * abs(p - ta.req[ti])
                if best is None or cost < best[0]:
                    best = (cost, seq, times, p)
        if best is None:
            return None
        cost, seq, times, p = best

        def commit():
            P.promised = p
            van.stops = van.stops[:i0] + seq
            for s, (a, d) in zip(seq, times):
                s.arr, s.dep = a, d
                if s.kind == "P":
                    van.pick_dep[s.ti] = d
        return cost, commit


def make_fleet(cfg: SimConfig, rng: np.random.Generator, dow: int) -> list[Van]:
    scale = cfg.saturday_factor if dow == 5 else cfg.sunday_factor if dow == 6 else 1.0
    n = max(5, int(round(cfg.n_vans * min(1.0, scale * 1.2))))
    starts_h = [5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0]
    w = np.array([1, 2, 3, 3, 3, 2, 2, 1.5, 1.5, 1.5, 1.5, 1.5])
    dw = np.array([d[3] for d in cfg.depots])
    vans = []
    for v in range(n):
        s = float(rng.choice(starts_h, p=w / w.sum())) * 60
        name, lat, lon, _ = cfg.depots[rng.choice(len(cfg.depots), p=dw / dw.sum())]
        vans.append(Van(v, name, s, s + cfg.shift_hours * 60, lat, lon))
    return vans


def schedule_day(trips: pd.DataFrame, cfg: SimConfig, travel: TravelModel, rng: np.random.Generator):
    """Assign every trip to a van. Returns (vans, trips + van_id/promised/denied)."""
    dow = int(trips["dow"].iloc[0])
    weekend = dow >= 5
    sched = Scheduler(cfg, travel, weekend)
    vans = make_fleet(cfg, rng, dow)
    ta = TripArrays(trips, travel, cfg, weekend)
    board = [m * cfg.plan_dwell_factor for m in cfg.board_mean]
    alight = [m * cfg.plan_dwell_factor for m in cfg.alight_mean]

    van_id = [-1] * len(trips)
    promised = [math.nan] * len(trips)
    for ti, tr in enumerate(trips.itertuples(index=False)):
        P = Stop("P", ti, tr.o_lat, tr.o_lon, board[tr.mobility], tr.mobility)
        D = Stop("D", ti, tr.d_lat, tr.d_lon, alight[tr.mobility], tr.mobility)
        req = ta.req[ti]
        busy, idle = [], []
        for van in vans:
            if van.start > req + 30 or van.end < req + 20:
                continue
            if not van.stops:
                idle.append((km_scalar(van.lat0, van.lon0, tr.o_lat, tr.o_lon, 1.0), van))
                continue
            ref = van.stops[0]
            for s in reversed(van.stops):
                if s.dep <= req:
                    ref = s
                    break
            busy.append((km_scalar(ref.lat, ref.lon, tr.o_lat, tr.o_lon, 1.0), van))
        busy.sort(key=lambda x: x[0])
        idle.sort(key=lambda x: x[0])
        best = None
        for _, van in busy[: cfg.candidate_vans] + idle[:2]:   # fresh vans pay the yard deadhead
            r = sched.best_insertion(van, ti, ta, P, D)
            if r and (best is None or r[0] < best[0]):
                best = (r[0], r[1], van)
        if best:
            best[1]()
            van_id[ti] = best[2].vid
            promised[ti] = P.promised
    out = trips.copy()
    out["van_id"] = van_id
    out["promised"] = promised
    out["denied"] = out["van_id"] < 0
    return vans, out


def plan_table(vans: list[Van], trips: pd.DataFrame) -> pd.DataFrame:
    tid = trips["trip_id"].tolist()
    rows = [dict(van_id=v.vid, depot=v.depot, seq=k, kind=s.kind, trip_id=tid[s.ti], ti=s.ti,
                 lat=s.lat, lon=s.lon, mobility=s.mob, promised=s.promised,
                 plan_arr=s.arr, plan_dep=s.dep)
            for v in vans for k, s in enumerate(v.stops)]
    return pd.DataFrame(rows)
