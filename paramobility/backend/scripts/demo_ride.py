"""Export the presentation's ride from the dashboard's simulated day, and replay it.

Takes one rider's trip from fleet.json (the dashboard's simulated day), samples the van's track
every 15 sim-seconds from a little before the pickup window to the drop-off, and writes it with
the appointment to app/demo/presentation_ride.json, which the backend replays on the dashboard's
clock (app/demo/presentation.py). Then replays it here and prints what the rider app would show,
minute by minute, so the appointment time can be tuned until the story lands: a slow decline
while waiting, a jump at the pickup, drops at the next two pickups, then the ask.

    uv run python scripts/demo_ride.py --trip D15T0852 --appointment 11:52

The replay records Google's live drive times in the demo cache (DEMO_CACHE_PATH), so a second
run, or the presentation on the same server, replays exactly the same numbers.
"""

import argparse
import json
from pathlib import Path

from app.demo import presentation
from app.prediction import live

FLEET = Path(__file__).resolve().parents[2] / "frontend/dashboard/public/data/fleet.json"
EVERY_MIN = 0.25  # one fix per 15 sim-seconds, like the rider app's throttle


def position_at(van: dict, t: float) -> tuple[float, float]:
    """(lat, lng) at sim time t, interpolated like the dashboard's positionAt."""
    times, path = van["times"], van["path"]
    t = min(max(t, times[0]), times[-1])
    i = max(0, min(next((k for k, x in enumerate(times) if x > t), len(times)) - 1, len(times) - 2))
    span = times[i + 1] - times[i]
    f = min(1.0, max(0.0, (t - times[i]) / span)) if span > 0 else 1.0
    lng = path[i][0] + (path[i + 1][0] - path[i][0]) * f
    lat = path[i][1] + (path[i + 1][1] - path[i][1]) * f
    return round(lat, 5), round(lng, 5)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--trip", default="D15T0852", help="trip id in the simulated day")
    ap.add_argument("--appointment", required=True, help="HH:MM, the rider's appointment")
    ap.add_argument("--lead", type=float, default=10, help="minutes before the window opens")
    ap.add_argument("--rider", default="Denise", help="name if the rider app has no profile")
    ap.add_argument("--title", default="Cardiology")
    ap.add_argument("--name", default="Alta Bates Summit", help="as Leeway says it")
    ap.add_argument("--origin", default="Fruitvale, Oakland")
    ap.add_argument("--dest", default="Alta Bates Summit Medical Center, 2450 Ashby Ave, Berkeley")
    args = ap.parse_args()

    fleet = json.loads(FLEET.read_text())
    stops = sorted(fleet["stops"], key=lambda s: s["t"])
    pickup = next(s for s in stops if s["trip"] == args.trip and s["kind"] == "P")
    dropoff = next(s for s in stops if s["trip"] == args.trip and s["kind"] == "D")
    van = next(v for v in fleet["vans"] if v["id"] == pickup["van"])
    window_start = live.parse_clock(pickup["window"][0])
    first = (window_start - args.lead) // EVERY_MIN * EVERY_MIN
    n = int((dropoff["t"] + 2 - first) / EVERY_MIN) + 1
    track = [[round(first + k * EVERY_MIN, 2), *position_at(van, first + k * EVERY_MIN)]
             for k in range(n)]
    on_way = [s for s in stops if s["van"] == van["id"] and pickup["t"] < s["t"] < dropoff["t"]]

    ride = {
        "sim_trip": args.trip,
        "van": van["id"],
        "rider": args.rider,
        "title": args.title,
        "appointment_name": args.name,
        "origin": args.origin,
        "dest": args.dest,
        "origin_pos": [pickup["pos"][1], pickup["pos"][0]],
        "dest_pos": [dropoff["pos"][1], dropoff["pos"][0]],
        "window_start": window_start,
        "appointment": live.parse_clock(args.appointment),
        "pickup_t": round(pickup["t"], 2),
        "dropoff_t": round(dropoff["t"], 2),
        "stops_on_way": [
            {"t": round(s["t"], 2), "kind": s["kind"], "place": s["place"]} for s in on_way
        ],
        "track": track,
    }
    presentation.RIDE_PATH.write_text(json.dumps(ride, separators=(",", ":")) + "\n")
    print(f"wrote {presentation.RIDE_PATH.name}: van {van['id']}, {len(track)} points; on the way:")
    for s in on_way:
        print(f"  {presentation.hhmm(s['t'])}  {s['kind']} {s['place']}")
    print()
    presentation.check(presentation.Ride.load())


if __name__ == "__main__":
    main()
