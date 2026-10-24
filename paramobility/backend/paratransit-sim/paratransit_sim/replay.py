"""Time-ordered event stream for one simulated day (JSON lines, sorted by `t`,
minutes after midnight). Feeds a dashboard, a voice agent, or your own predictor.

  van_pos  every 2 min per active van: lat, lon, behind_plan (minutes)
  stop     van reached a stop: kind P (pickup) / D (drop-off), status,
           promised window, minutes past window, and the delay breakdown
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .config import MOBILITY, SimConfig

CAUSES = ["late_start_min", "incident_min", "hard_address_min", "rider_not_ready_min", "breakdown_min"]


def clock(t):
    t = int(round(t))
    h, m = divmod(t, 60)
    return f"{h % 24:d}:{m:02d}"


def _positions(ex: pd.DataFrame, step=2.0):
    events = []
    for van_id, g in ex.groupby("van_id"):
        segs, behind = [], 0.0
        for s in g.sort_values("seq").itertuples(index=False):
            if s.status == "skipped":
                continue
            segs.append((s.depart_prev, s.arr, s.prev_lat, s.prev_lon, s.lat, s.lon, behind))
            behind = s.dep - s.plan_dep
            segs.append((s.arr, s.dep, s.lat, s.lon, s.lat, s.lon, behind))
        if not segs:
            continue
        t, i = np.ceil(segs[0][0] / step) * step, 0
        while t <= segs[-1][1]:
            while i < len(segs) - 1 and t > segs[i][1]:
                i += 1
            t0, t1, a0, o0, a1, o1, b = segs[i]
            f = 0.0 if t1 <= t0 else min(1.0, max(0.0, (t - t0) / (t1 - t0)))
            events.append(dict(t=float(t), type="van_pos", van_id=int(van_id),
                               lat=round(a0 + f * (a1 - a0), 5), lon=round(o0 + f * (o1 - o0), 5),
                               behind_plan=round(float(b), 1)))
            t += step
    return events


def build_replay(day_result, cfg: SimConfig):
    ex, trips = day_result.executed, day_result.trips
    tinfo = trips.set_index("trip_id")
    events = _positions(ex)
    for s in ex.itertuples(index=False):
        if s.status == "skipped":
            continue
        tr = tinfo.loc[s.trip_id]
        ev = dict(t=float(s.arr), type="stop", van_id=int(s.van_id), kind=s.kind, trip_id=s.trip_id,
                  rider_id=tr.rider_id, status=s.status, lat=s.lat, lon=s.lon,
                  place=tr.o_name if s.kind == "P" else tr.d_name, mobility=MOBILITY[int(s.mobility)],
                  behind_plan=round(float(s.behind_plan_min), 1),
                  inherited_behind=round(float(s.inherited_behind_min), 1),
                  causes={c: round(float(getattr(s, c)), 1) for c in CAUSES if getattr(s, c) > 0})
        if s.kind == "P":
            ev.update(window=[clock(s.promised), clock(s.promised + cfg.window_min)],
                      minutes_past_window=round(float(s.late_past_window), 1), on_time=bool(s.on_time))
        events.append(ev)
    events.sort(key=lambda e: (e["t"], e["type"] != "van_pos"))
    return events


def pick_persona(day_result) -> dict | None:
    """An outbound dialysis/medical trip that ends up past its window: the demo story."""
    t = day_result.trips
    c = t[(t["leg"] == "out") & t["purpose"].isin(["dialysis", "medical"]) & (t["pickup_status"] == "ok")
          & t["late_past_window"].between(5, 25) & t["promised"].between(9 * 60, 13 * 60)]
    if c.empty:
        c = t[t["late_past_window"] > 0]
    if c.empty:
        return None
    c = c.assign(_d=(c["purpose"] != "dialysis"), _km=c["direct_km"]).sort_values(["_d", "_km"])
    r = c.iloc[0]
    van = day_result.executed[day_result.executed["van_id"] == r.van_id]
    k = int(van.loc[(van["trip_id"] == r.trip_id) & (van["kind"] == "P"), "seq"].iloc[0])
    return dict(name="Maria", trip_id=r.trip_id, rider_id=r.rider_id, van_id=int(r.van_id),
                purpose=r.purpose, pickup=r.o_name, dropoff=r.d_name, mobility=MOBILITY[int(r.mobility)],
                window=f"{clock(r.promised)}-{clock(r.promised + 30)}",
                appointment=None if r.appointment != r.appointment else clock(r.appointment),
                actual_pickup=clock(r.actual_pickup), minutes_past_window=round(float(r.late_past_window), 1),
                stops_before_on_van=k)


def write_jsonl(path, events):
    with open(path, "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
