"""Road routing via the public OSRM demo router, cached on disk.

  fetch_routes        per-leg road geometry for drawing vans on the map
  build_road_network  anchor-to-anchor road distances that TravelModel uses
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson"


def _key(lat1, lon1, lat2, lon2):
    return f"{lat1:.5f},{lon1:.5f};{lat2:.5f},{lon2:.5f}"


def _fetch(lat1, lon1, lat2, lon2):
    url = OSRM_URL.format(lon1, lat1, lon2, lat2)
    req = urllib.request.Request(url, headers={"User-Agent": "paratransit-sim"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
            if data.get("code") == "Ok":
                return [[round(c[1], 5), round(c[0], 5)] for c in data["routes"][0]["geometry"]["coordinates"]]
            return None
        except Exception:
            time.sleep(1.0 + attempt)
    return None


def fetch_routes(pairs, cache_path: str | None = None, workers: int = 4) -> dict:
    """pairs: iterable of (lat1, lon1, lat2, lon2). Returns {key: [[lat, lon], ...]}."""
    cache = {}
    if cache_path and os.path.exists(cache_path):
        with open(cache_path) as f:
            cache = json.load(f)
    todo = {}
    for p in pairs:
        k = _key(*p)
        if k not in cache and p[:2] != p[2:]:
            todo[k] = p
    if todo:
        print(f"fetching {len(todo)} road routes from OSRM ...")
        with ThreadPoolExecutor(workers) as ex:
            for k, route in zip(todo, ex.map(lambda p: _fetch(*p), todo.values())):
                if route:
                    cache[k] = route
        missing = sum(k not in cache for k in todo)
        if missing:
            print(f"  {missing} routes unavailable, drawing those as straight lines")
        if cache_path:
            with open(cache_path, "w") as f:
                json.dump(cache, f)
    return cache


def route_for(cache: dict, lat1, lon1, lat2, lon2):
    return cache.get(_key(lat1, lon1, lat2, lon2)) or [[lat1, lon1], [lat2, lon2]]


TABLE_URL = "https://router.project-osrm.org/table/v1/driving/{}?{}"
TABLE_MAX = 100  # coordinates per request on the public server


def _table(coords, params):
    url = TABLE_URL.format(";".join(f"{lon:.5f},{lat:.5f}" for lat, lon in coords), params)
    req = urllib.request.Request(url, headers={"User-Agent": "paratransit-sim"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            if data.get("code") == "Ok":
                return data
        except Exception:
            pass
        time.sleep(1.0 + 2 * attempt)
    raise RuntimeError("OSRM table request failed")


def build_road_network(path: str, centers, cell_km=1.0, reach_km=4.5, max_snap_m=700.0, workers=4):
    """Road-distance matrix between grid anchors covering the service area, saved as .npz.

    centers: (lat, lon) points riders and vans gather around; grid cells farther than
    reach_km from all of them are skipped, and cells whose nearest road is more than
    max_snap_m away (bay, hills) are dropped.
    """
    from .geo import BBOX
    lat0, lat1, lon0, lon1 = BBOX
    dlat = cell_km / 111.0
    dlon = cell_km / (111.0 * np.cos(np.radians((lat0 + lat1) / 2)))
    glat = np.arange(lat0, lat1, dlat) + dlat / 2
    glon = np.arange(lon0, lon1, dlon) + dlon / 2
    G = np.array([(a, o) for a in glat for o in glon])
    C = np.asarray(centers, dtype=float)
    kx = 111.0 * np.cos(np.radians(lat0))
    near = (np.hypot((G[:, None, 0] - C[None, :, 0]) * 111.0,
                     (G[:, None, 1] - C[None, :, 1]) * kx) <= reach_km).any(axis=1)
    cand = G[near]

    print(f"snapping {len(cand)} grid cells to roads ...")
    chunks = [cand[i:i + TABLE_MAX - 1] for i in range(0, len(cand), TABLE_MAX - 1)]
    with ThreadPoolExecutor(workers) as ex:
        snaps = list(ex.map(lambda c: _table(c, "sources=0&annotations=distance")["destinations"], chunks))
    anchors = {}
    for wp in (w for ch in snaps for w in ch):
        if wp["distance"] <= max_snap_m:
            lon, lat = wp["location"]
            anchors[(round(lat, 5), round(lon, 5))] = None
    A = np.array(list(anchors))
    n, b = len(A), TABLE_MAX // 2
    blocks = [(i, j) for i in range(0, n, b) for j in range(0, n, b)]
    print(f"{n} road anchors, fetching {n}x{n} distance matrix in {len(blocks)} requests ...")

    def block(ij):
        i, j = ij
        src, dst = A[i:i + b], A[j:j + b]
        q = (f"sources={';'.join(map(str, range(len(src))))}"
             f"&destinations={';'.join(map(str, range(len(src), len(src) + len(dst))))}&annotations=distance")
        return _table(np.vstack([src, dst]), q)["distances"]

    M = np.full((n, n), np.nan)
    with ThreadPoolExecutor(workers) as ex:
        for (i, j), d in zip(blocks, ex.map(block, blocks)):
            M[i:i + b, j:j + b] = np.array(d, dtype=float)  # None -> nan
    np.fill_diagonal(M, 0.0)
    np.savez_compressed(path, anchors=A, km=M / 1000.0, cell_deg=np.array([dlat, dlon]))
    print(f"saved road network to {path} ({np.isnan(M).sum()} unroutable pairs)")
