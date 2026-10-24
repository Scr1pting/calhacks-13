"""East Bay geography (AC Transit / BART paratransit area) and travel times.

Hospitals use real, rounded locations. Dialysis centers, senior centers and
stores are SYNTHETIC placeholders in plausible cities. Swap in OpenStreetMap
POIs if you want more realism.
"""
from __future__ import annotations

import csv
import math
import os

import numpy as np

from .config import SimConfig

# name, lat, lon, weight (share of riders, ASSUMPTION), radius_km
AREAS = [
    ("Downtown Oakland / Chinatown", 37.8005, -122.2711, 1.6, 0.8),
    ("Fruitvale", 37.7748, -122.2242, 1.3, 1.0),
    ("Deep East Oakland", 37.7466, -122.1817, 1.2, 1.2),
    ("West Oakland", 37.8124, -122.2945, 0.7, 0.6),
    ("North Oakland", 37.8338, -122.2633, 0.6, 0.7),
    ("Emeryville", 37.8313, -122.2852, 0.3, 0.4),
    ("Berkeley", 37.8716, -122.2727, 1.0, 1.0),
    ("Albany / El Cerrito", 37.8985, -122.3030, 0.6, 0.8),
    ("Richmond", 37.9358, -122.3478, 1.0, 1.2),
    ("San Pablo", 37.9621, -122.3455, 0.6, 0.7),
    ("Pinole / Hercules", 38.0000, -122.2900, 0.4, 1.0),
    ("Alameda", 37.7652, -122.2416, 0.6, 0.9),
    ("San Leandro", 37.7249, -122.1561, 0.9, 1.1),
    ("Castro Valley", 37.6941, -122.0864, 0.5, 1.0),
    ("Hayward", 37.6688, -122.0808, 1.1, 1.4),
    ("Union City", 37.5934, -122.0439, 0.5, 1.0),
    ("Fremont", 37.5485, -121.9886, 1.0, 1.8),
    ("Newark", 37.5297, -122.0402, 0.3, 0.8),
]

# name, purpose, lat, lon
DESTINATIONS = [
    ("Highland Hospital, Oakland", "medical", 37.7987, -122.2318),
    ("Kaiser Oakland Medical Center", "medical", 37.8250, -122.2560),
    ("Alta Bates, Berkeley", "medical", 37.8566, -122.2575),
    ("Summit Campus, Oakland", "medical", 37.8195, -122.2640),
    ("Kaiser San Leandro", "medical", 37.7020, -122.1490),
    ("Eden Medical Center, Castro Valley", "medical", 37.6960, -122.0750),
    ("Washington Hospital, Fremont", "medical", 37.5560, -121.9790),
    ("Kaiser Richmond", "medical", 37.9360, -122.3490),
    ("Dialysis Center - Oakland (synthetic)", "dialysis", 37.8060, -122.2690),
    ("Dialysis Center - East Oakland (synthetic)", "dialysis", 37.7560, -122.1900),
    ("Dialysis Center - Berkeley (synthetic)", "dialysis", 37.8650, -122.2900),
    ("Dialysis Center - Richmond (synthetic)", "dialysis", 37.9400, -122.3400),
    ("Dialysis Center - San Leandro (synthetic)", "dialysis", 37.7100, -122.1550),
    ("Dialysis Center - Hayward (synthetic)", "dialysis", 37.6600, -122.0900),
    ("Dialysis Center - Fremont (synthetic)", "dialysis", 37.5500, -121.9850),
    ("Senior Center - Oakland Chinatown (synthetic)", "senior", 37.7990, -122.2700),
    ("Senior Center - Berkeley (synthetic)", "senior", 37.8680, -122.2690),
    ("Adult Day Program - Fruitvale (synthetic)", "senior", 37.7760, -122.2250),
    ("Senior Center - Richmond (synthetic)", "senior", 37.9380, -122.3460),
    ("Senior Center - Hayward (synthetic)", "senior", 37.6700, -122.0820),
    ("Adult Day Program - Fremont (synthetic)", "senior", 37.5470, -121.9900),
    ("Senior Center - San Leandro (synthetic)", "senior", 37.7260, -122.1570),
    ("Bayfair Center, San Leandro", "other", 37.6970, -122.1270),
    ("Shopping - Fremont (synthetic)", "other", 37.5550, -121.9840),
    ("Shopping - Richmond (synthetic)", "other", 37.9750, -122.3300),
    ("Grocery - Oakland (synthetic)", "other", 37.8100, -122.2650),
    ("Grocery - Berkeley (synthetic)", "other", 37.8700, -122.2950),
]

BBOX = (37.48, 38.03, -122.36, -121.92)  # lat_min, lat_max, lon_min, lon_max

# Average door-to-door city speed by hour (mph), before the freeway boost. ASSUMPTION.
DEFAULT_SPEED_MPH = [
    22, 22, 22, 22, 22, 21,
    18, 13, 11.5, 12.5, 15, 15,
    15, 15, 14.5, 13, 11.5, 11,
    12.5, 16, 19, 20, 21, 22,
]
PEAK_HOURS = {7, 8, 9, 15, 16, 17, 18}


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(a))


def km_scalar(lat1, lon1, lat2, lon2, detour):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a)) * detour


class RoadNetwork:
    """Road km between any two points, from a precomputed anchor-to-anchor matrix.

    Each point maps to the road anchor nearest its grid cell (points in the bay map
    to the shore). The anchor distance is then corrected by how much closer or
    farther apart the two points are than their anchors.
    """

    def __init__(self, path: str, detour: float):
        z = np.load(path)
        A, M = z["anchors"], z["km"]
        self.dlat, self.dlon = (float(x) for x in z["cell_deg"])
        self.detour = detour
        H = haversine_km(A[:, None, 0], A[:, None, 1], A[None, :, 0], A[None, :, 1])
        M = np.where(np.isnan(M), H * detour, M)
        self.km_ab, self.hav_ab = M.tolist(), H.tolist()
        lat0, lat1, lon0, lon1 = BBOX
        self.lat0, self.lon0 = lat0, lon0
        glat = lat0 + (np.arange(int((lat1 - lat0) / self.dlat) + 1) + 0.5) * self.dlat
        glon = lon0 + (np.arange(int((lon1 - lon0) / self.dlon) + 1) + 0.5) * self.dlon
        kx = math.cos(math.radians(lat0))
        d = (glat[:, None, None] - A[None, None, :, 0]) ** 2 + ((glon[None, :, None] - A[None, None, :, 1]) * kx) ** 2
        self.lut = d.argmin(axis=2).tolist()
        self.ni, self.nj = len(glat) - 1, len(glon) - 1

    def anchor(self, lat, lon):
        i = min(self.ni, max(0, int((lat - self.lat0) / self.dlat)))
        j = min(self.nj, max(0, int((lon - self.lon0) / self.dlon)))
        return self.lut[i][j]

    def km(self, lat1, lon1, lat2, lon2):
        hav = km_scalar(lat1, lon1, lat2, lon2, 1.0)
        a, b = self.anchor(lat1, lon1), self.anchor(lat2, lon2)
        if a == b:
            return hav * self.detour
        return max(hav, self.km_ab[a][b] + self.detour * (hav - self.hav_ab[a][b]))


def load_road_network(cfg: SimConfig) -> RoadNetwork | None:
    path = cfg.road_network
    if not path:
        return None
    if not os.path.exists(path):
        from .routing import build_road_network
        centers = [a[1:3] for a in AREAS] + [d[2:4] for d in DESTINATIONS] + [d[1:3] for d in cfg.depots]
        try:
            build_road_network(path, centers)
        except Exception as e:
            print(f"WARNING: could not build road network ({e}); using straight-line x detour distances")
            return None
    return RoadNetwork(path, cfg.detour_factor)


_NETWORKS: dict = {}


class TravelModel:
    """Median travel minutes and spread by distance and time of day."""

    def __init__(self, cfg: SimConfig):
        self.cfg = cfg
        key = (cfg.road_network, cfg.detour_factor)
        if key not in _NETWORKS:
            _NETWORKS[key] = load_road_network(cfg)
        self.net = _NETWORKS[key]
        speeds = list(DEFAULT_SPEED_MPH)
        sig = [cfg.sigma_peak if h in PEAK_HOURS else cfg.sigma_offpeak for h in range(24)]
        if cfg.speed_profile_csv:
            with open(cfg.speed_profile_csv) as f:
                for row in csv.DictReader(f):
                    h = int(row["hour"])
                    speeds[h] = float(row["speed_mph"])
                    if row.get("sigma"):
                        sig[h] = float(row["sigma"])
        self.speed_kmh = [s * 1.609344 for s in speeds]
        self.sigma_by_hour = np.array(sig)
        self._speed_arr = np.array(self.speed_kmh)

    def road_km(self, lat1, lon1, lat2, lon2):
        if self.net is None:
            return km_scalar(lat1, lon1, lat2, lon2, self.cfg.detour_factor)
        return self.net.km(lat1, lon1, lat2, lon2)

    def median_scalar(self, km, t, weekend):
        c = self.cfg
        v = self.speed_kmh[int(t // 60) % 24] * (1 + c.freeway_boost * min(km, c.freeway_km) / c.freeway_km)
        if weekend:
            v *= c.weekend_speed_factor
        return km / v * 60.0 + c.curb_overhead_min

    def median_minutes(self, km, t_min, weekend):
        c = self.cfg
        km = np.asarray(km, dtype=float)
        v = self._speed_arr[(np.asarray(t_min) // 60).astype(int) % 24]
        v = v * (1 + c.freeway_boost * np.minimum(km, c.freeway_km) / c.freeway_km)
        if weekend:
            v = v * c.weekend_speed_factor
        return km / v * 60.0 + c.curb_overhead_min

    def sigma(self, t_min):
        return self.sigma_by_hour[(np.asarray(t_min) // 60).astype(int) % 24]


def sample_home(rng: np.random.Generator):
    w = np.array([a[3] for a in AREAS])
    i = rng.choice(len(AREAS), p=w / w.sum())
    name, lat, lon, _, r = AREAS[i]
    lat = float(np.clip(lat + rng.normal(0, r / 111.0 / 1.5), BBOX[0], BBOX[1]))
    lon = float(np.clip(lon + rng.normal(0, r / 88.0 / 1.5), BBOX[2], BBOX[3]))
    return name, lat, lon
