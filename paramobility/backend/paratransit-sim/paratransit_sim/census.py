"""Where likely paratransit riders live: Census tracts weighted by residents with an
ambulatory (walking) difficulty, ACS 5-year table B18105, all ages 5+.

Tracts come from Alameda (06001) and Contra Costa (06013) counties and are kept if
they lie within SERVICE_REACH_KM of one of the AREAS centers, which approximates
EBP's service area (AC Transit / BART district) and drops the Tri-Valley and central
Contra Costa, which other agencies serve. Cached as CSV; built on first use.
"""
from __future__ import annotations

import csv
import io
import math
import os
import urllib.request

import numpy as np

from .geo import AREAS, BBOX, km_scalar

ACS_YEAR = 2024
# keyless bulk "table-based summary file": one pipe-delimited row per geography, nationwide
ACS_URL = ("https://www2.census.gov/programs-surveys/acs/summary_file/{y}/table-based-SF/data/"
           "5YRData/acsdt5y{y}-b18105.dat")
GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteer/{y}_gaz_tracts_06.txt"
TRACT_PREFIXES = ("1400000US06001", "1400000US06013")  # tracts in Alameda, Contra Costa
# B18105 "with an ambulatory difficulty", male then female, ages 5-17, 18-34, 35-64, 65-74, 75+
AMBULATORY = [f"B18105_E{n:03d}" for n in (4, 7, 10, 13, 16, 20, 23, 26, 29, 32)]
SERVICE_REACH_KM = 6.0


def _open(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "paratransit-sim"}), timeout=120)


def _get(url):
    with _open(url) as r:
        return r.read().decode("utf-8")


def build_home_tracts(path: str, year: int = ACS_YEAR):
    print(f"downloading ACS {year} 5-year table B18105 (~75 MB, keeps Alameda + Contra Costa tracts) ...")
    weight = {}
    with _open(ACS_URL.format(y=year)) as r:
        head = r.readline().decode().strip().split("|")
        cols = [head.index(v) for v in AMBULATORY]
        for line in r:
            if not line.startswith(TRACT_PREFIXES[0].encode()) and not line.startswith(TRACT_PREFIXES[1].encode()):
                continue
            f = line.decode().strip().split("|")
            # blanks and negative values are Census sentinels for "not available"
            weight[f[0][len("1400000US"):]] = sum(max(0, int(f[c])) for c in cols if f[c].lstrip("-").isdigit())
    lat0, lat1, lon0, lon1 = BBOX
    out = []
    for g in csv.DictReader(io.StringIO(_get(GAZ_URL.format(y=year))), delimiter="\t"):
        g = {k.strip(): v.strip() for k, v in g.items()}
        geoid = g["GEOID"]
        if geoid not in weight or weight[geoid] == 0:
            continue
        lat, lon = float(g["INTPTLAT"]), float(g["INTPTLONG"])
        if not (lat0 <= lat <= lat1 and lon0 <= lon <= lon1):
            continue
        d = [km_scalar(lat, lon, a[1], a[2], 1.0) for a in AREAS]
        if min(d) > SERVICE_REACH_KM:
            continue
        out.append(dict(geoid=geoid, lat=lat, lon=lon, land_km2=round(float(g["ALAND"]) / 1e6, 4),
                        weight=weight[geoid], area=AREAS[int(np.argmin(d))][0]))
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    print(f"saved {len(out)} service-area tracts ({sum(r['weight'] for r in out):,} residents with a "
          f"walking difficulty, ACS {year - 4}-{year}) to {path}")


class HomeTracts:
    def __init__(self, path: str):
        if not os.path.exists(path):
            build_home_tracts(path)
        with open(path) as f:
            rows = list(csv.DictReader(f))
        self.lat = np.array([float(r["lat"]) for r in rows])
        self.lon = np.array([float(r["lon"]) for r in rows])
        self.area = [r["area"] for r in rows]
        w = np.array([float(r["weight"]) for r in rows])
        self.p = w / w.sum()
        # spread homes over roughly the tract: sd = half the radius of a circle with the tract's land area
        self.sd_km = np.array([0.5 * math.sqrt(float(r["land_km2"]) / math.pi) for r in rows])

    def sample(self, rng: np.random.Generator):
        i = rng.choice(len(self.p), p=self.p)
        lat = self.lat[i] + rng.normal(0, self.sd_km[i] / 111.0)
        lon = self.lon[i] + rng.normal(0, self.sd_km[i] / (111.0 * math.cos(math.radians(self.lat[i]))))
        lat0, lat1, lon0, lon1 = BBOX
        return self.area[i], float(np.clip(lat, lat0, lat1)), float(np.clip(lon, lon0, lon1))
