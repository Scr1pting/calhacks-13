"""Riders and their daily trip requests (all synthetic)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import SimConfig
from .geo import DESTINATIONS, TravelModel, sample_home

# Share of riders by main trip purpose (ASSUMPTION)
PURPOSE_SHARE = {"dialysis": 0.20, "medical": 0.30, "senior": 0.30, "other": 0.20}
# Probability a rider of each purpose travels on a given day of week (Mon=0)
DAY_PROB = {
    "dialysis": None,  # fixed MWF or TTS schedule
    "medical": [0.35, 0.35, 0.35, 0.35, 0.33, 0.06, 0.02],
    "senior": [0.55, 0.55, 0.55, 0.55, 0.50, 0.10, 0.03],
    "other": [0.30, 0.30, 0.30, 0.30, 0.32, 0.40, 0.30],
}
DIALYSIS_SLOTS = [6 * 60 + 30, 11 * 60 + 30, 16 * 60 + 30]  # chair times
MOBILITY_SHARE = [0.45, 0.25, 0.30]  # ambulatory, walker, wheelchair (ASSUMPTION)


def generate_riders(cfg: SimConfig, rng: np.random.Generator) -> pd.DataFrame:
    rows = []
    purposes = list(PURPOSE_SHARE)
    pshare = np.array(list(PURPOSE_SHARE.values()))
    for i in range(cfg.rider_pool):
        hood, lat, lon = sample_home(rng)
        purpose = purposes[rng.choice(len(purposes), p=pshare)]
        cands = [d for d in DESTINATIONS if d[1] == purpose]
        # riders tend to use a nearby destination of their type
        dists = np.array([np.hypot(lat - d[2], (lon - d[3]) * 0.79) for d in cands])
        w = np.exp(-dists / 0.15)  # EBP trips average ~9.8 miles, so riders travel across cities
        dest = cands[rng.choice(len(cands), p=w / w.sum())]
        rows.append(dict(
            rider_id=f"R{i:05d}", home_area=hood, home_lat=lat, home_lon=lon,
            mobility=int(rng.choice(3, p=MOBILITY_SHARE)), purpose=purpose,
            dest_name=dest[0], dest_lat=dest[2], dest_lon=dest[3],
            dialysis_days="MWF" if rng.random() < 0.5 else "TTS",
            dialysis_slot=int(rng.choice(DIALYSIS_SLOTS)),
        ))
    return pd.DataFrame(rows)


def _travels_today(r, dow: int, rng) -> bool:
    if r.purpose == "dialysis":
        days = {0, 2, 4} if r.dialysis_days == "MWF" else {1, 3, 5}
        return dow in days and rng.random() < 0.95
    return rng.random() < DAY_PROB[r.purpose][dow]


def generate_day(day: int, riders: pd.DataFrame, cfg: SimConfig, travel: TravelModel,
                 rng: np.random.Generator) -> pd.DataFrame:
    """One-way trip requests for one service day. day 0 is a Monday."""
    dow = day % 7
    target = cfg.trips_per_weekday * (cfg.saturday_factor if dow == 5 else cfg.sunday_factor if dow == 6 else 1.0)
    weekend = dow >= 5
    trips = []
    order = rng.permutation(len(riders))
    for idx in order:
        if len(trips) >= target:
            break
        r = riders.iloc[idx]
        if not _travels_today(r, dow, rng):
            continue
        km = float(travel.road_km(r.home_lat, r.home_lon, r.dest_lat, r.dest_lon))
        if r.purpose == "dialysis":
            appt = r.dialysis_slot + rng.normal(0, 5)
            stay = 225 + rng.normal(0, 10)
        elif r.purpose == "medical":
            appt = rng.uniform(8.5 * 60, 16 * 60)
            appt = round(appt / 15) * 15
            stay = rng.uniform(60, 150)
        elif r.purpose == "senior":
            appt = 9.5 * 60 + rng.normal(0, 40)
            stay = 300 + rng.normal(0, 50)
        else:
            appt = rng.uniform(9.5 * 60, 15.5 * 60)
            stay = rng.uniform(60, 120)
        est = travel.median_scalar(km, appt - 40, weekend)
        has_appt = r.purpose in ("dialysis", "medical")
        out_req = appt - est - (30 if has_appt else 10)
        back_req = appt + stay
        base = dict(rider_id=r.rider_id, day=day, dow=dow, mobility=int(r.mobility),
                    purpose=r.purpose, home_area=r.home_area, direct_km=km)
        trips.append(dict(base, leg="out", requested=out_req,
                          appointment=appt if has_appt else np.nan,
                          o_lat=r.home_lat, o_lon=r.home_lon, d_lat=r.dest_lat, d_lon=r.dest_lon,
                          o_name=f"Home ({r.home_area})", d_name=r.dest_name))
        trips.append(dict(base, leg="back", requested=back_req, appointment=np.nan,
                          o_lat=r.dest_lat, o_lon=r.dest_lon, d_lat=r.home_lat, d_lon=r.home_lon,
                          o_name=r.dest_name, d_name=f"Home ({r.home_area})"))
    df = pd.DataFrame(trips)
    df["requested"] = df["requested"].clip(5 * 60, 22 * 60)
    df = df.sort_values("requested").reset_index(drop=True)
    df.insert(0, "trip_id", [f"D{day:02d}T{i:04d}" for i in range(len(df))])
    return df
