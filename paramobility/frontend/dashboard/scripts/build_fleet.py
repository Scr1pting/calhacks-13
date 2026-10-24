"""Build the dashboard's fleet data from the paratransit simulator's replay.

    python scripts/build_fleet.py   # from paramobility/frontend/dashboard

Reads backend/paratransit-sim/data (replay.jsonl, replay_meta.json and the
OSRM road geometry in routes_cache.json) and writes public/data/fleet.json:

- vans: for each van, a road-following path with a time per vertex (minutes
  after midnight), and how far behind plan it was over the day;
- stops: every pickup and drop-off, with outcome and delay causes;
- meta: the simulated day, the demo rider (Maria) and the vans' yards.

The replay only samples van positions every 2 minutes. Those samples lie on
the road route of each leg, so they tell us when the van left the previous
stop; the route geometry fills in the road between them.

Standard library only.
"""

import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIM = HERE.parents[2] / "backend" / "paratransit-sim" / "data"
OUT = HERE.parent / "public" / "data" / "fleet.json"

DEPOTS = [  # paratransit_sim/config.py
    ("Oakland yard", 37.7700, -122.2050),
    ("Hayward yard", 37.6450, -122.1100),
    ("Richmond yard", 37.9300, -122.3600),
]
SIMPLIFY_M = 4.0  # path simplification tolerance, meters
VAN_KMH = 25.0  # fallback speed for legs too short to have a position sample


def key(a, b):
    return f"{a[0]:.5f},{a[1]:.5f};{b[0]:.5f},{b[1]:.5f}"


def meters(a, b):
    """Approximate distance between (lat, lon) points."""
    dy = (b[0] - a[0]) * 111_320
    dx = (b[1] - a[1]) * 111_320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def simplify(pts, tol):
    """Ramer-Douglas-Peucker on (lat, lon) points, tolerance in meters."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    cos = math.cos(math.radians(pts[0][0]))
    xy = [(p[1] * 111_320 * cos, p[0] * 111_320) for p in pts]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-9
        best, at = 0.0, -1
        for k in range(i + 1, j):
            x, y = xy[k]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, at = d, k
        if best > tol:
            keep[at] = True
            stack += [(i, at), (at, j)]
    return [p for p, k in zip(pts, keep) if k]


def cumulative(pts):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + meters(a, b))
    return cum


def fraction_along(pts, cum, p):
    """How far along the polyline (0..1) the point closest to p lies, projected onto its segments."""
    if cum[-1] == 0:
        return 1.0
    cos = math.cos(math.radians(p[0]))
    px, py = p[1] * cos, p[0]
    best, at = float("inf"), 0.0
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        ax, ay, bx, by = a[1] * cos, a[0], b[1] * cos, b[0]
        dx, dy = bx - ax, by - ay
        seg = dx * dx + dy * dy
        u = 0.0 if seg == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg))
        d = (ax + u * dx - px) ** 2 + (ay + u * dy - py) ** 2
        if d < best:
            best, at = d, cum[i] + u * (cum[i + 1] - cum[i])
    return at / cum[-1]


def departure(prev_arr, arr, pts, cum, samples):
    """When the van left for this leg: from position samples taken while it drove it."""
    estimates = []
    for t, p in samples:
        if not (prev_arr < t < arr):
            continue
        f = fraction_along(pts, cum, p)
        if 0.03 < f < 0.97:  # clearly moving along this leg
            estimates.append((t - f * arr) / (1 - f))
    if estimates:
        dep = statistics.median(estimates)
    else:
        dep = arr - (cum[-1] / 1000) / VAN_KMH * 60
    return min(max(dep, prev_arr), arr - 0.2)


def build():
    meta = json.loads((SIM / "replay_meta.json").read_text())
    cache = json.loads((SIM / "routes_cache.json").read_text())
    stops_by_van, pos_by_van = defaultdict(list), defaultdict(list)
    stop_events = []
    with open(SIM / "replay.jsonl") as f:
        for line in f:
            e = json.loads(line)
            if e["type"] == "van_pos":
                pos_by_van[e["van_id"]].append((e["t"], (e["lat"], e["lon"]), e["behind_plan"]))
            else:
                stops_by_van[e["van_id"]].append(e)
                stop_events.append(e)

    vans = []
    for van_id in sorted(pos_by_van):
        pos = sorted(pos_by_van[van_id])
        samples = [(t, p) for t, p, _ in pos]
        stops = sorted(stops_by_van.get(van_id, []), key=lambda e: e["t"])
        start = pos[0][1]
        depot = min(DEPOTS, key=lambda d: meters(start, d[1:]))[1:]

        # Waypoints: yard -> every stop -> back to the yard (when the van drove back).
        points = [(pos[0][0], depot)] + [(s["t"], (s["lat"], s["lon"])) for s in stops]
        back = key(points[-1][1], depot)
        if stops and back in cache:
            home = next((t for t, p in samples if t > points[-1][0] and meters(p, depot) < 60),
                        pos[-1][0])
            points.append((home, depot))

        path, times = [], []

        def add(p, t):
            if times and t < times[-1]:
                t = times[-1]
            path.append([round(p[1], 5), round(p[0], 5)])
            times.append(round(t, 2))

        add(points[0][1], points[0][0])
        for (prev_arr, a), (arr, b) in zip(points, points[1:]):
            if meters(a, b) < 1:
                add(b, arr)
                continue
            full = [tuple(p) for p in (cache.get(key(a, b)) or [a, b])]
            # The simulator drives the full route at a steady speed, so time it on that,
            # then draw a simplified version.
            dep = departure(prev_arr, arr, full, cumulative(full), samples)
            leg = simplify(full, SIMPLIFY_M)
            cum = cumulative(leg)
            add(leg[0], dep)  # waited at the previous stop until now
            total = cum[-1] or 1.0
            for p, c in zip(leg[1:], cum[1:]):
                add(p, dep + (arr - dep) * c / total)
        add(points[-1][1], pos[-1][0])  # parked until the last sample

        vans.append({
            "id": van_id,
            "path": path,
            "times": times,
            # [t, minutes behind plan], every 2 minutes
            "behind": [[t, b] for t, _, b in pos],
        })

    stops = [{
        "t": round(e["t"], 2),
        "van": e["van_id"],
        "kind": e["kind"],
        "trip": e["trip_id"],
        "rider": e["rider_id"],
        "place": e["place"],
        "status": e["status"],
        "pos": [round(e["lon"], 5), round(e["lat"], 5)],
        "mobility": e["mobility"],
        "behind": e["behind_plan"],
        "inherited": e["inherited_behind"],
        "causes": e["causes"],
        **({"window": e["window"], "late": e["minutes_past_window"], "onTime": e["on_time"]}
           if e["kind"] == "P" else {}),
    } for e in stop_events]

    data = {
        "meta": {**meta, "depots": [{"name": n, "pos": [lon, lat]} for n, lat, lon in DEPOTS]},
        "vans": vans,
        "stops": stops,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    n_pts = sum(len(v["path"]) for v in vans)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB): "
          f"{len(vans)} vans, {n_pts} path points, {len(stops)} stops")


if __name__ == "__main__":
    build()
