"""Direct drive time between two points at a departure time, with a small on-disk cache.

Providers, in order:
* GOOGLE_MAPS_KEY -> Google Routes computeRoutes, TRAFFIC_AWARE (future departures only).
* ORS_API_KEY -> OpenRouteService directions, driving-car: real roads but no traffic.
* neither -> RuntimeError("no routing key"). The notebook's straight-line fallback is not used here.

Departures are LA local time (a naive datetime is taken as LA time), rounded to 15 min. Past
departures roll forward to the same weekday and time next week, since Google only predicts
traffic for the future.

The cache key is both coordinates (5 decimals), weekday, HH:MM and provider (ORS ignores the
time), so reruns stay free. Google's Maps Platform terms only allow temporary caching for
performance, so the cache stays local (CACHE_PATH, git-ignored) and entries expire after
max_age_days.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Los_Angeles")
CACHE_PATH = Path(os.environ.get("DRIVE_CACHE", Path(__file__).with_name("drive_cache.json")))
TIMEOUT_S = 10.0
ROUND_MIN = 15

GOOGLE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car"

LatLng = tuple[float, float]

_lock = threading.Lock()


class RoutingError(RuntimeError):
    """The routing provider failed or returned no route."""


def provider() -> str:
    """'google' or 'ors', whichever key is set; raises if neither is."""
    if os.environ.get("GOOGLE_MAPS_KEY"):
        return "google"
    if os.environ.get("ORS_API_KEY"):
        return "ors"
    raise RoutingError("no routing key")


def departure(depart: datetime, now: datetime | None = None) -> datetime:
    """depart in LA time, rounded to 15 min and moved to a future week if it has passed."""
    t = depart.replace(tzinfo=TZ) if depart.tzinfo is None else depart.astimezone(TZ)
    minutes = t.hour * 60 + t.minute + t.second / 60
    midnight = t.replace(hour=0, minute=0, second=0, microsecond=0)
    t = midnight + timedelta(minutes=round(minutes / ROUND_MIN) * ROUND_MIN)  # wall-clock time
    now = datetime.now(TZ) if now is None else now
    while t <= now:
        t += timedelta(weeks=1)
    return t


def drive_minutes(origin: LatLng, destination: LatLng, depart: datetime,
                  max_age_days: float = 7.0) -> float:
    """Direct drive minutes from origin to destination (lat, lng) leaving at depart."""
    name = provider()
    t = departure(depart)
    when = f"{t.weekday()}|{t:%H:%M}" if name == "google" else "*"
    key = "|".join([*(f"{v:.5f}" for v in (*origin, *destination)), when, name])

    with _lock:
        cache = _load()
        hit = cache.get(key)
        if hit and time.time() - hit["at"] < max_age_days * 86400:
            return hit["min"]

    minutes = _google(origin, destination, t) if name == "google" else _ors(origin, destination)

    with _lock:
        cache = _load()
        cache[key] = {"min": minutes, "at": time.time()}
        _save(cache, max_age_days)
    return minutes


def _google(origin: LatLng, destination: LatLng, t: datetime) -> float:
    point = lambda p: {"location": {"latLng": {"latitude": p[0], "longitude": p[1]}}}
    body = {"origin": point(origin), "destination": point(destination), "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE", "departureTime": t.isoformat()}
    res = _post(GOOGLE_URL, body, {"X-Goog-Api-Key": os.environ["GOOGLE_MAPS_KEY"],
                                   "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"})
    try:
        return float(res["routes"][0]["duration"].removesuffix("s")) / 60
    except (KeyError, IndexError, ValueError) as e:
        raise RoutingError(f"google: no route in response {res!r}") from e


def _ors(origin: LatLng, destination: LatLng) -> float:
    body = {"coordinates": [[origin[1], origin[0]], [destination[1], destination[0]]]}  # [lng, lat]
    res = _post(ORS_URL, body, {"Authorization": os.environ["ORS_API_KEY"]})
    try:
        return float(res["routes"][0]["summary"]["duration"]) / 60
    except (KeyError, IndexError, ValueError) as e:
        raise RoutingError(f"ors: no route in response {res!r}") from e


def _post(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RoutingError(f"{url}: HTTP {e.code}: {e.read()[:300]!r}") from e
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise RoutingError(f"{url}: {e}") from e


def _load() -> dict:
    try:
        return json.loads(CACHE_PATH.read_text())
    except (OSError, json.JSONDecodeError):  # the cache is only a speed-up: carry on without it
        return {}


def _save(cache: dict, max_age_days: float) -> None:
    cutoff = time.time() - max_age_days * 86400
    fresh = {k: v for k, v in cache.items() if v["at"] >= cutoff}
    tmp = CACHE_PATH.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(fresh))
        tmp.replace(CACHE_PATH)
    except OSError:  # e.g. a read-only deploy: the lookup itself still succeeded
        pass
