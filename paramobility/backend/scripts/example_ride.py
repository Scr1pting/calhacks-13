"""Make the presentation's example ride: picked up, then straight off the way (dev only).

    python -m scripts.example_ride --window 10:15 --pickup 10:40 --appointment 11:20

Instead of a ride from the simulated day (scripts/demo_ride.py), this builds one to tell the
story clearly, on real streets (OpenRouteService): the rider lives on International Blvd in
East Oakland and her appointment is at Highland Hospital, up the same road. The van comes down
International and picks her up, then keeps going, down the same road the other way, to pick up
another rider in San Leandro, and only then turns round for Highland.

Writes app/demo/presentation_ride.json like demo_ride.py does (one fix per 15 sim-seconds for
the backend's replay; until the pickup her phone is at home, since nobody knows where the van
is), plus the van's street path with times for the dashboard's film (its way to her door
included) and the other rider's stop. Then replays it and prints what the rider app would show,
so the times can be tuned. Book it the way the planner would: the window for a 90% chance (see
app.prediction.ontime.latest_window_start).
"""

import argparse
import json
import math
from pathlib import Path

from app.core.config import get_settings
from app.demo import presentation
from app.prediction import live, routing

EVERY_MIN = 0.25  # one fix per 15 sim-seconds, like the rider app's throttle
TRAFFIC = 1.25  # city traffic on top of the router's free-flow times (--traffic)
SNAP_M = 60  # how far her door may move to reach the road
SNAP_PLACE_M = 400  # and the other places (the hospital's entrance is well inside its grounds)

# (lat, lng)
APPROACH = (37.762206, -122.193291)  # International Blvd at 66th Ave: the van comes down it
HOME = (37.754422, -122.177594)  # International Blvd at 84th Ave, East Oakland
OTHER = (37.713866, -122.140925)  # the other rider, E 14th St, San Leandro: the other way
HOSPITAL = (37.798255, -122.231631)  # Highland Hospital, 1411 E 31st St, Oakland


def km(a, b):
    """Distance in km between two (lng, lat) points, close enough at this scale."""
    return math.hypot((a[0] - b[0]) * 88.0, (a[1] - b[1]) * 111.0)


def without_spurs(coords, marks, back_km=0.012, out_km=0.02, reach=8):
    """The path without the little out-and-back spurs routing makes where a waypoint sits just
    off the road (it drives in, turns round, drives out). Keeps the waypoints' indices right."""
    keep = list(range(len(coords)))
    n = 1
    while n < len(keep) - 1:
        a = coords[keep[n - 1]]
        # Comes back near a within a few vertices, after going further away: a spur.
        back = next(
            (
                m
                for m in range(n + 1, min(n + reach, len(keep)))
                if km(a, coords[keep[m]]) < back_km
                and max(km(a, coords[keep[k]]) for k in range(n, m)) > out_km
            ),
            None,
        )
        if back is not None:
            del keep[n:back]
        elif km(a, coords[keep[n + 1]]) < back_km:
            del keep[n]  # a last step out and straight back
        else:
            n += 1
    index = {old: new for new, old in enumerate(keep)}
    return [coords[k] for k in keep], [
        index[min(keep, key=lambda k, m=m: abs(k - m))] for m in marks
    ]


def osrm_directions(points, radiuses):
    """The public OSRM server's route (ROUTING_PROVIDER=osrm, when the quotas are spent), in the
    shape OpenRouteService answers: one step per segment, with its seconds."""
    where = ";".join(f"{p[1]},{p[0]}" for p in points)
    res = routing._get(
        f"{routing.OSRM_URL}/{where}",
        {
            "overview": "full",
            "geometries": "geojson",
            "annotations": "duration",
            "radiuses": ";".join(str(r) for r in radiuses),
        },
    )
    route = res["routes"][0]
    durations = [d for leg in route["legs"] for d in leg["annotation"]["duration"]]
    marks, at = [0], 0
    for leg in route["legs"]:
        at += len(leg["annotation"]["duration"])
        marks.append(at)
    steps = [{"way_points": [k, k + 1], "duration": d} for k, d in enumerate(durations)]
    return {
        "features": [
            {
                "geometry": {"coordinates": route["geometry"]["coordinates"]},
                "properties": {"way_points": marks, "segments": [{"steps": steps}]},
            }
        ]
    }


def directions(points, radiuses):
    """The street path through (lat, lng) points: [lng, lat] vertices and seconds to reach each,
    and the vertex index of every waypoint. Kept in example_route.json (git-ignored, next to the
    demo cache), so tuning the times doesn't ask OpenRouteService again."""
    body = {
        "coordinates": [[p[1], p[0]] for p in points],
        "instructions": True,
        "radiuses": radiuses,
    }
    cache = Path(get_settings().demo_cache_path).with_name("example_route.json")
    saved = json.loads(cache.read_text()) if cache.exists() else {}
    if "body" in saved:  # the cache's first format: one route
        saved = {json.dumps(saved["body"], sort_keys=True): saved["response"]}
    name = routing.provider()
    key = json.dumps(body if name != "osrm" else {"osrm": body}, sort_keys=True)
    if key not in saved:
        if name == "osrm":
            saved[key] = osrm_directions(points, radiuses)
        else:
            saved[key] = routing._post(
                routing.ORS_URL + "/geojson", body, {"Authorization": get_settings().ors_api_key}
            )
        cache.write_text(json.dumps(saved))
    res = saved[key]
    feature = res["features"][0]
    coords = feature["geometry"]["coordinates"]
    marks = feature["properties"]["way_points"]
    coords, marks = without_spurs(coords, marks)
    secs = [0.0] * len(coords)
    # Each step's pace (seconds per km), spread over the cleaned path by distance.
    raw = feature["geometry"]["coordinates"]
    pace = []  # (km along the raw path where a step ends, its seconds per km)
    along = 0.0
    for seg in feature["properties"]["segments"]:
        for step in seg["steps"]:
            i, j = step["way_points"]
            length = sum(km(raw[k], raw[k + 1]) for k in range(i, j))
            along += length
            pace.append((along, step["duration"] / length if length else 0.0))
    done = 0.0
    for k in range(1, len(coords)):
        step = km(coords[k - 1], coords[k])
        rate = next((r for end, r in pace if end >= done), pace[-1][1])
        secs[k] = secs[k - 1] + step * rate
        done += step
    return coords, secs, marks


def clock(s: str) -> float:
    return live.parse_clock(s)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--appointment", required=True, help="HH:MM")
    ap.add_argument("--window", default="10:30", help="HH:MM, the pickup window opens (30 minutes)")
    ap.add_argument("--pickup", default="10:46", help="HH:MM, when the van gets to her")
    ap.add_argument("--board", type=float, default=1.5, help="minutes she takes to board")
    ap.add_argument("--other-board", type=float, default=2.5, help="minutes the other rider takes")
    ap.add_argument("--lead", type=float, default=10, help="minutes before the window opens")
    ap.add_argument("--traffic", type=float, default=TRAFFIC, help="times the free-flow drive")
    args = ap.parse_args()

    # The van coming up International to her door, timed to get there at the pickup.
    approach, approach_secs, _ = directions([APPROACH, HOME], [SNAP_PLACE_M, SNAP_M])
    coords, secs, marks = directions([HOME, OTHER, HOSPITAL], [SNAP_M, SNAP_PLACE_M, SNAP_PLACE_M])
    other_at = marks[1]
    window_start, pickup_t = clock(args.window), clock(args.pickup)

    # The van's path with times: it comes, she boards, it drives, the other rider boards, on.
    arrive_in = approach_secs[-1] * args.traffic / 60
    path = [
        [round(pickup_t - arrive_in + approach_secs[k] * args.traffic / 60, 3), q[1], q[0]]
        for k, q in enumerate(approach[:-1])
    ]
    path.append([pickup_t, coords[0][1], coords[0][0]])
    t = pickup_t + args.board
    for k in range(len(coords)):
        if k:
            t += (secs[k] - secs[k - 1]) * args.traffic / 60
        path.append([round(t, 3), coords[k][1], coords[k][0]])
        if k == other_at:
            other_t = t
            t += args.other_board
            path.append([round(t, 3), coords[k][1], coords[k][0]])
    dropoff_t = t
    home = (coords[0][1], coords[0][0])

    def where(at):
        """(lat, lng) of her phone at sim time `at`: at home until the pickup, then the van's."""
        if at <= pickup_t:
            return round(home[0], 5), round(home[1], 5)
        for a, b in zip(path, path[1:], strict=False):
            if a[0] <= at <= b[0]:
                f = (at - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 1
                return round(a[1] + (b[1] - a[1]) * f, 5), round(a[2] + (b[2] - a[2]) * f, 5)
        return path[-1][1], path[-1][2]

    first = (window_start - args.lead) // EVERY_MIN * EVERY_MIN
    n = int((dropoff_t + 2 - first) / EVERY_MIN) + 1
    track = [[round(first + k * EVERY_MIN, 2), *where(first + k * EVERY_MIN)] for k in range(n)]

    ride = {
        "sim_trip": "example",
        "van": 0,
        "rider": "Denise",
        "title": "Cardiology",
        "appointment_name": "Highland Hospital",
        "origin": "East Oakland",
        "dest": "Highland Hospital, 1411 E 31st St, Oakland",
        "origin_pos": list(home),
        "dest_pos": [path[-1][1], path[-1][2]],
        "window_start": window_start,
        "appointment": clock(args.appointment),
        "pickup_t": round(pickup_t, 2),
        "dropoff_t": round(dropoff_t, 2),
        "stops_on_way": [
            {
                "t": round(other_t, 2),
                "kind": "P",
                "place": "Home (San Leandro)",
                "pos": [coords[other_at][1], coords[other_at][0]],
            }
        ],
        "track": track,
        "path": path,
    }
    presentation.RIDE_PATH.write_text(json.dumps(ride, separators=(",", ":")) + "\n")
    hhmm = presentation.hhmm
    total = sum(km(coords[k], coords[k + 1]) for k in range(len(coords) - 1))
    print(f"wrote {presentation.RIDE_PATH.name}: {len(track)} fixes, {len(path)} path points")
    print(
        f"  van on its way from {hhmm(path[0][0])}, picks her up {hhmm(pickup_t)}, "
        f"other rider {hhmm(other_t)}, at Highland {hhmm(dropoff_t)} ({total:.1f} km)"
    )
    print()
    presentation.check(presentation.Ride.load())


if __name__ == "__main__":
    main()
