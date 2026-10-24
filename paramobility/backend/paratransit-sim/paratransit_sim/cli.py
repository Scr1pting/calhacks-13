"""Command line entry point.

  python -m paratransit_sim run-all --days 14       # calibrate, generate, build replay
  python -m paratransit_sim calibrate
  python -m paratransit_sim generate --days 14
  python -m paratransit_sim replay --day 15
  python -m paratransit_sim serve --speed 60        # live feed + map at http://localhost:8765
"""
from __future__ import annotations

import argparse
import json
import os
import time

import pandas as pd

from .calibrate import calibrate
from .config import SimConfig
from .pipeline import World, summarize
from .replay import build_replay, pick_persona, write_jsonl

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _cfg(args) -> SimConfig:
    path = os.path.join(args.out, "calibrated_config.json")
    if getattr(args, "config", None):
        return SimConfig.load(args.config)
    if os.path.exists(path):
        return SimConfig.load(path)
    return SimConfig()


def cmd_calibrate(args):
    os.makedirs(args.out, exist_ok=True)
    print(f"Calibrating schedule tightness to on-time target {SimConfig().target_otp:.1%} ...")
    cfg, report = calibrate(SimConfig())
    cfg.save(os.path.join(args.out, "calibrated_config.json"))
    with open(os.path.join(args.out, "calibration_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    a = report["achieved"]
    print(f"-> plan_factor={cfg.plan_factor}  on-time={a['otp']:.3f}  denied={a['denial_rate']:.3f}")


def cmd_generate(args):
    os.makedirs(args.out, exist_ok=True)
    cfg = _cfg(args)
    w = World(cfg)
    results, trips, stops = [], [], []
    for d in range(args.days):
        t0 = time.time()
        r = w.simulate_day(d)
        results.append(r)
        trips.append(r.trips)
        stops.append(r.executed.assign(day=d))
        s = summarize([r])
        print(f"  day {d:2d} ({DAYS[d % 7]}): {len(r.trips):4d} trips  on-time {s['otp']:.3f}  "
              f"no-show {s['no_show_rate']:.3f}  ({time.time() - t0:.1f}s)")
    pd.concat(trips).to_csv(os.path.join(args.out, "trips.csv"), index=False)
    pd.concat(stops).to_csv(os.path.join(args.out, "stops.csv"), index=False)
    w.riders.to_csv(os.path.join(args.out, "riders.csv"), index=False)
    summary = summarize(results)
    summary["reference_ebp_dec_2019"] = dict(otp_ytd=0.879, otp_standard=0.91, over_60_late_ytd=0.002,
                                             rider_no_show_ytd=0.026, revenue_miles_per_passenger=9.8,
                                             minutes_per_passenger=42.0)
    with open(os.path.join(args.out, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps({k: v for k, v in summary.items() if k != "otp_by_hour"}, indent=2))


def cmd_replay(args):
    os.makedirs(args.out, exist_ok=True)
    cfg = _cfg(args)
    r = World(cfg).simulate_day(args.day, seed_offset=7)
    events = build_replay(r, cfg, routes_cache=os.path.join(args.out, "routes_cache.json"))
    write_jsonl(os.path.join(args.out, "replay.jsonl"), events)
    persona = pick_persona(r)
    lat = r.executed["lat"]
    lon = r.executed["lon"]
    meta = dict(day=args.day, weekday=DAYS[args.day % 7], n_events=len(events),
                start=events[0]["t"], end=events[-1]["t"], vans=int(r.executed["van_id"].nunique()),
                bounds=[[float(lat.min()), float(lon.min())], [float(lat.max()), float(lon.max())]],
                persona=persona, summary={k: v for k, v in summarize([r]).items() if k != "otp_by_hour"})
    with open(os.path.join(args.out, "replay_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"replay: {len(events)} events, {meta['vans']} vans, persona: {persona}")


def cmd_serve(args):
    from .server import serve
    serve(args.out, args.port, args.speed, args.start)


def main():
    ap = argparse.ArgumentParser(prog="paratransit_sim")
    ap.add_argument("--out", default="data")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("calibrate")
    g = sub.add_parser("generate")
    g.add_argument("--days", type=int, default=14)
    g.add_argument("--config")
    rp = sub.add_parser("replay")
    rp.add_argument("--day", type=int, default=15)
    rp.add_argument("--config")
    sv = sub.add_parser("serve")
    sv.add_argument("--port", type=int, default=8765)
    sv.add_argument("--speed", type=float, default=60.0, help="sim seconds per real second")
    sv.add_argument("--start", type=float, default=6 * 60, help="start clock in minutes after midnight")
    ra = sub.add_parser("run-all")
    ra.add_argument("--days", type=int, default=14)
    ra.add_argument("--day", type=int, default=15)
    ra.add_argument("--config")
    args = ap.parse_args()
    if args.cmd == "run-all":
        cmd_calibrate(args)
        args.config = None
        cmd_generate(args)
        cmd_replay(args)
    else:
        {"calibrate": cmd_calibrate, "generate": cmd_generate, "replay": cmd_replay, "serve": cmd_serve}[args.cmd](args)


if __name__ == "__main__":
    main()
