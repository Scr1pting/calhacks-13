"""Hourly street speeds from AC Transit real-time bus positions (511.org SIRI API).

  collect   poll AC Transit vehicle positions every --interval seconds, append to
            <out>/bus511/pings-YYYY-MM-DD.jsonl (run it for a few weekdays)
  profile   turn the pings into the hour,speed_mph,sigma CSV that SimConfig's
            speed_profile_csv reads

Buses stop at bus stops and vans don't, so absolute bus speeds understate van
speeds. The profile keeps only the SHAPE of the day: van speed at hour h =
FREE_FLOW_MPH * bus_speed(h) / bus_speed(free-flow hour). sigma is the day-to-day
spread of log speed for the same line, direction, place and hour, i.e. traffic
noise rather than differences between routes.

Token: free from https://511.org/open-data/token; put it in the API_511_KEY
environment variable or in ~/.511_token. The default rate limit is 60
requests per hour, so keep --interval at 60 s or more.
"""
from __future__ import annotations

import csv
import glob
import gzip
import json
import math
import os
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

from .geo import BBOX, DEFAULT_SPEED_MPH, km_scalar

URL = "https://api.511.org/transit/VehicleMonitoring?api_key={}&agency={}&format=json"
TZ = ZoneInfo("America/Los_Angeles")
FREE_FLOW_MPH = max(DEFAULT_SPEED_MPH)
SPAN_MIN = 8.0          # bus runs are cut into spans about as long as a van leg
MAX_GAP_MIN = 5.0       # a longer silence ends the run
MIN_SPANS_PER_HOUR = 30
MIN_SIGMA_GROUPS = 20


def token() -> str:
    t = os.environ.get("API_511_KEY")
    if not t and os.path.exists(os.path.expanduser("~/.511_token")):
        t = open(os.path.expanduser("~/.511_token")).read().strip()
    if not t:
        raise SystemExit("No 511 token: set API_511_KEY or write it to ~/.511_token "
                         "(free at https://511.org/open-data/token)")
    return t


def fetch(key: str, agency: str = "AC") -> list[dict]:
    req = urllib.request.Request(URL.format(key, agency), headers={"Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    data = json.loads(raw.decode("utf-8-sig"))  # 511 prefixes a byte-order mark
    vmd = data["Siri"]["ServiceDelivery"]["VehicleMonitoringDelivery"]
    if isinstance(vmd, list):
        vmd = vmd[0]
    rows = []
    for a in vmd.get("VehicleActivity") or []:
        j = a.get("MonitoredVehicleJourney") or {}
        loc = j.get("VehicleLocation") or {}
        fr = j.get("FramedVehicleJourneyRef") or {}
        try:
            lat, lon = float(loc["Latitude"]), float(loc["Longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        rows.append(dict(rec=a.get("RecordedAtTime"), veh=j.get("VehicleRef"), line=j.get("LineRef"),
                         dir=j.get("DirectionRef"), jid=f"{fr.get('DataFrameRef')}/{fr.get('DatedVehicleJourneyRef')}",
                         lat=lat, lon=lon))
    return rows


def collect(out_dir: str, interval: float = 90.0, agency: str = "AC"):
    key = token()
    os.makedirs(os.path.join(out_dir, "bus511"), exist_ok=True)
    print(f"collecting {agency} vehicle positions every {interval:.0f}s into {out_dir}/bus511/ (Ctrl+C to stop)")
    while True:
        t0 = time.time()
        try:
            rows = fetch(key, agency)
            day = datetime.now(TZ).strftime("%Y-%m-%d")
            with open(os.path.join(out_dir, "bus511", f"pings-{day}.jsonl"), "a") as f:
                for r in rows:
                    f.write(json.dumps(r) + "\n")
            print(f"{datetime.now(TZ):%H:%M:%S}  {len(rows)} vehicles", flush=True)
        except urllib.error.HTTPError as e:
            print(f"{datetime.now(TZ):%H:%M:%S}  HTTP {e.code} {e.reason}", flush=True)
            if e.code == 401:
                raise SystemExit("511 rejected the token")
            if e.code == 429:
                time.sleep(15 * 60)
        except Exception as e:  # network hiccups shouldn't end a multi-day collection
            print(f"{datetime.now(TZ):%H:%M:%S}  error: {e}", flush=True)
        time.sleep(max(0.0, interval - (time.time() - t0)))


def _local(rec: str) -> datetime:
    return datetime.fromisoformat(rec.replace("Z", "+00:00")).astimezone(TZ)


def load_pings(out_dir: str):
    """{(jid, veh): [(local_dt, lat, lon, line, dir)]} for weekday pings inside the sim area."""
    lat0, lat1, lon0, lon1 = BBOX
    runs, seen = defaultdict(list), set()
    for path in sorted(glob.glob(os.path.join(out_dir, "bus511", "pings-*.jsonl"))):
        with open(path) as f:
            for line in f:
                p = json.loads(line)
                if (not p.get("rec") or not p.get("line")  # no line = not in service (deadheading)
                        or not (lat0 <= p["lat"] <= lat1 and lon0 <= p["lon"] <= lon1)):
                    continue
                k = (p["jid"], p["veh"], p["rec"])
                if k in seen:  # the feed repeats a vehicle's last fix until it reports again
                    continue
                seen.add(k)
                dt = _local(p["rec"])
                if dt.weekday() < 5:
                    runs[(p["jid"], p["veh"])].append((dt, p["lat"], p["lon"], p["line"], p["dir"]))
    return runs


def spans(runs):
    """Yield (hour, line, dir, cell, speed_kmh, date) for ~SPAN_MIN-minute stretches of each run."""
    for pts in runs.values():
        pts.sort(key=lambda x: x[0])
        i = 0
        while i < len(pts) - 1:
            km, j = 0.0, i
            while j < len(pts) - 1:
                gap = (pts[j + 1][0] - pts[j][0]).total_seconds() / 60
                if gap > MAX_GAP_MIN or gap <= 0:
                    break
                km += km_scalar(pts[j][1], pts[j][2], pts[j + 1][1], pts[j + 1][2], 1.0)
                j += 1
                if (pts[j][0] - pts[i][0]).total_seconds() / 60 >= SPAN_MIN:
                    break
            mins = (pts[j][0] - pts[i][0]).total_seconds() / 60
            if mins >= SPAN_MIN * 0.75:
                v = km / (mins / 60)
                if 3.0 <= v <= 90.0:  # drop layovers at the end of the line and GPS jumps
                    mid = pts[i][0] + (pts[j][0] - pts[i][0]) / 2
                    cell = (round(pts[i][1] / 0.01), round(pts[i][2] / 0.01))
                    yield mid.hour, pts[i][3], pts[i][4], cell, v, mid.date()
            i = max(j, i + 1)


def profile(out_dir: str, out_csv: str):
    runs = load_pings(out_dir)
    if not runs:
        raise SystemExit(f"no weekday pings under {out_dir}/bus511/ - run `collect` first")
    by_hour = defaultdict(list)
    groups = defaultdict(list)
    days = set()
    for h, line, d, cell, v, date in spans(runs):
        by_hour[h].append(v)
        groups[(line, d, cell, h)].append((date, math.log(v)))
        days.add(date)

    med = {h: float(np.median(v)) for h, v in by_hour.items() if len(v) >= MIN_SPANS_PER_HOUR}
    if not med:
        raise SystemExit("not enough data yet; collect for longer")
    ref_h = max(med, key=med.get)
    # day-to-day noise: pooled variance of each day's mean log speed around its group's mean
    ss, dof = defaultdict(float), defaultdict(int)
    for (_, _, _, h), obs in groups.items():
        per_day = defaultdict(list)
        for date, lv in obs:
            per_day[date].append(lv)
        if len(per_day) < 2:
            continue
        m = np.array([np.mean(x) for x in per_day.values()])
        ss[h] += float(((m - m.mean()) ** 2).sum())
        dof[h] += len(m) - 1
    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hour", "speed_mph", "sigma", "bus_kmh", "n_spans", "source"])
        for h in range(24):
            if h in med:
                mph = FREE_FLOW_MPH * med[h] / med[ref_h]
                sig = f"{math.sqrt(ss[h] / dof[h]):.3f}" if dof[h] >= MIN_SIGMA_GROUPS else ""
                w.writerow([h, f"{mph:.1f}", sig, f"{med[h]:.1f}", len(by_hour[h]), "511"])
            else:
                w.writerow([h, DEFAULT_SPEED_MPH[h], "", "", len(by_hour.get(h, [])), "default"])
    print(f"{len(runs)} bus runs over {len(days)} weekdays; free-flow reference hour {ref_h}:00 "
          f"({med[ref_h]:.1f} km/h bus speed = {FREE_FLOW_MPH} mph van speed)")
    print(f"wrote {out_csv}")
