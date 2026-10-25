"""Live traffic signal from AC Transit buses: how much slower than their own timetable
buses are running in each area right now.

For two reports of the same bus trip MIN_GAP-MAX_GAP minutes apart, the bus's delay is
(predicted - timetabled) arrival at its next stop. The delay it GAINED between the two
reports, divided by the timetabled time for that stretch, is the slowdown where it drove:
+0.20 means buses here take 20% longer than scheduled. Using the gain (not the total delay)
pins the slowdown to the area the bus is in, not to wherever it got late earlier, and being
relative to the bus's own timetable it carries over to vans even though vans drive faster.

Aggregated to CELL_DEG cells x BIN_MIN-minute bins (median over buses), saved as CSV, and
used by the simulation to stretch van travel times (bus_to_van_beta) and as a model feature.
"""
from __future__ import annotations

import csv
import glob
import json
import os
from collections import defaultdict
from datetime import datetime

import numpy as np

from .bus511 import TZ

CELL_DEG = 0.015       # ~1.5 km
BIN_MIN = 15
MIN_GAP, MAX_GAP = 5.0, 15.0
MIN_BUSES = 2          # bus pairs needed before a cell/bin is trusted


def _t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ)


def _cell(lat, lon):
    return int(np.floor(lat / CELL_DEG)), int(np.floor(lon / CELL_DEG))


def bus_slowdowns(out_dir: str):
    """Yield (date, minute_of_day, lat, lon, slowdown) for each bus stretch with timetable data."""
    trips, seen = defaultdict(list), set()
    for path in sorted(glob.glob(os.path.join(out_dir, "bus511", "pings-*.jsonl"))):
        with open(path) as f:
            for line in f:
                p = json.loads(line)
                if not (p.get("aimed") and p.get("expected") and p.get("line")):
                    continue
                k = (p["jid"], p["veh"], p["rec"])
                if k in seen:
                    continue
                seen.add(k)
                delay = (_t(p["expected"]) - _t(p["aimed"])).total_seconds() / 60
                trips[(p["jid"], p["veh"])].append((_t(p["rec"]), p["lat"], p["lon"], delay))
    for fixes in trips.values():
        fixes.sort(key=lambda x: x[0])
        i = 0
        while i < len(fixes) - 1:
            j = i + 1
            while j < len(fixes) and (fixes[j][0] - fixes[i][0]).total_seconds() / 60 < MIN_GAP:
                j += 1
            if j == len(fixes):
                break
            gap = (fixes[j][0] - fixes[i][0]).total_seconds() / 60
            if gap <= MAX_GAP:
                gained = fixes[j][3] - fixes[i][3]
                scheduled = gap - gained
                if scheduled > 1.0:
                    s = gained / scheduled
                    if -0.6 <= s <= 2.0:  # beyond this: timepoint holds, layovers, bad predictions
                        mid = fixes[i][0] + (fixes[j][0] - fixes[i][0]) / 2
                        yield (mid.date().isoformat(), mid.hour * 60 + mid.minute,
                               (fixes[i][1] + fixes[j][1]) / 2, (fixes[i][2] + fixes[j][2]) / 2, s)
            i = j


def build_congestion(out_dir: str, csv_path: str):
    cells = defaultdict(list)
    for date, minute, lat, lon, s in bus_slowdowns(out_dir):
        ci, cj = _cell(lat, lon)
        cells[(date, int(minute // BIN_MIN) * BIN_MIN, ci, cj)].append(s)
    rows = [dict(date=d, bin_min=b, lat=round((ci + .5) * CELL_DEG, 4), lon=round((cj + .5) * CELL_DEG, 4),
                 slowdown=round(float(np.median(v)), 4), n=len(v))
            for (d, b, ci, cj), v in sorted(cells.items()) if len(v) >= MIN_BUSES]
    if not rows:
        raise SystemExit("no bus stretches with timetable data yet; keep bus511-collect running")
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    s = np.array([r["slowdown"] for r in rows])
    dates = sorted({r["date"] for r in rows})
    print(f"{len(rows)} area/15-min values over {', '.join(dates)}: median slowdown {np.median(s):+.0%}, "
          f"10-90% range {np.percentile(s, 10):+.0%} to {np.percentile(s, 90):+.0%}")
    print(f"wrote {csv_path}")


class Congestion:
    """Bus slowdown lookup; simulated day d replays recorded bus day d mod (number of days)."""

    def __init__(self, csv_path: str, beta: float):
        self.beta = beta
        self.by_key = {}
        dates = set()
        with open(csv_path) as f:
            for r in csv.DictReader(f):
                ci, cj = _cell(float(r["lat"]), float(r["lon"]))
                self.by_key[(r["date"], int(r["bin_min"]), ci, cj)] = float(r["slowdown"])
                dates.add(r["date"])
        self.dates = sorted(dates)

    def _dates_for(self, day: int):
        # the assigned recorded day first; other days fill time slots it didn't record
        k = day % len(self.dates)
        return self.dates[k:] + self.dates[:k]

    def slowdown(self, day: int, lat: float, lon: float, t_min: float) -> float:
        """Median bus slowdown near (lat, lon) at sim minute t_min, or nan where no bus reported."""
        b = int(t_min // BIN_MIN) * BIN_MIN
        ci, cj = _cell(lat, lon)
        for date in self._dates_for(day):
            v = self.by_key.get((date, b, ci, cj))
            if v is not None:
                return v
            near = [self.by_key[k] for di in (-1, 0, 1) for dj in (-1, 0, 1)
                    if (k := (date, b, ci + di, cj + dj)) in self.by_key]
            if near:
                return float(np.median(near))
        return float("nan")

    def factor(self, s: float) -> float:
        return 1.0 if s != s else float(np.clip(1.0 + self.beta * s, 0.8, 2.0))

    def events(self, day: int):
        """bus_delay events for the replay feed, one per area and 15-min slot."""
        out = {}
        for date in reversed(self._dates_for(day)):  # assigned day last, so it wins
            for (d, b, ci, cj), s in self.by_key.items():
                if d == date:
                    out[(b, ci, cj)] = s
        return [dict(t=float(b), type="bus_delay", lat=round((ci + .5) * CELL_DEG, 4),
                     lon=round((cj + .5) * CELL_DEG, 4), slowdown=s) for (b, ci, cj), s in out.items()]
