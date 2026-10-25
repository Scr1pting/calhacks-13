"""Direct drive time between two points at a departure time, with a small on-disk cache.

Providers, in order (keys come from Settings, i.e. the environment or .env):
* GOOGLE_MAPS_KEY -> Google Routes computeRoutes, TRAFFIC_AWARE (future departures only).
* ORS_API_KEY -> OpenRouteService directions, driving-car: real roads but no traffic.
* neither -> RuntimeError("no routing key"). The notebook's straight-line fallback is not used here.

Departures are LA local time (a naive datetime is taken as LA time), rounded to 15 min. Past
departures roll forward to the same weekday and time next week, since Google only predicts
traffic for the future.

The cache key is both coordinates (5 decimals), weekday, HH:MM and provider (ORS ignores the
time), so reruns stay free. Google's Maps Platform terms only allow temporary caching for
performance, so the cache stays local (DRIVE_CACHE_PATH, git-ignored) and entries expire
after max_age_days.

Addresses become coordinates with geocode (Google Geocoding, else OpenRouteService's Pelias),
cached the same way under the normalized address. Google's key needs the Geocoding API enabled
as well as Routes.

Live calls (drive_now, during a ride) depart now and are never cached on disk, since the van's
position changes every call. Only with DEMO_CACHE=1 are live and route responses recorded in
DEMO_CACHE_PATH and replayed afterwards, so a demo survives bad venue Wi-Fi. A scripted demo
(app.demo) turns that on for its own calls with replaying(), and hears about every answer that
wasn't recorded yet.
"""

import contextlib
import contextvars
import json
import logging
import math
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from app.core.config import get_settings

TZ = ZoneInfo("America/Los_Angeles")
TIMEOUT_S = 10.0
ROUND_MIN = 15

GOOGLE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"

LatLng = tuple[float, float]

_lock = threading.Lock()
log = logging.getLogger(__name__)
# Keys the current replaying() block had to fetch live; None outside one.
_replay_misses: contextvars.ContextVar[list[str] | None] = contextvars.ContextVar(
    "replay_misses", default=None
)


class RoutingError(RuntimeError):
    """The routing provider failed or returned no route."""


def provider() -> str:
    """'google' or 'ors', whichever key is set ('osrm' when ROUTING_PROVIDER says so); raises
    if none is."""
    settings = get_settings()
    if settings.routing_provider == "osrm":
        return "osrm"
    if settings.google_maps_key:
        return "google"
    if settings.ors_api_key:
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


def drive_minutes(
    origin: LatLng, destination: LatLng, depart: datetime, max_age_days: float = 7.0
) -> float:
    """Direct drive minutes from origin to destination (lat, lng) leaving at depart."""
    name = provider()
    t = departure(depart)
    when = f"{t.weekday()}|{t:%H:%M}" if name == "google" else "*"
    key = "|".join([*(f"{v:.5f}" for v in (*origin, *destination)), when, name])
    return _cached(
        key,
        max_age_days,
        lambda: (
            _google(origin, destination, t)
            if name == "google"
            else _drive(name, origin, destination)
        ),
    )


def geocode(address: str, max_age_days: float = 7.0) -> LatLng:
    """(lat, lng) of a street address or place name."""
    name = provider()
    key = "|".join(["geo", " ".join(address.lower().split()), name])
    lat, lng = _cached(
        key,
        max_age_days,
        lambda: _google_geocode(address) if name == "google" else _ors_geocode(address),
    )
    return lat, lng


def drive_now(origin: LatLng, destination: LatLng) -> float:
    """Direct drive minutes from origin to destination leaving now (traffic-aware with Google)."""
    name = provider()
    key = "|".join(["now", *(f"{v:.5f}" for v in (*origin, *destination)), name])
    return _demo_cached(
        key,
        lambda: (
            _google(origin, destination) if name == "google" else _drive(name, origin, destination)
        ),
    )


def route_track(origin: LatLng, destination: LatLng) -> tuple[list[LatLng], list[float]]:
    """Google's driving route as points with cumulative minutes from the start (for demo tracks).

    Each step's static duration is spread over its points in proportion to distance.
    """
    if provider() != "google":
        raise RoutingError("route tracks need GOOGLE_MAPS_KEY")
    key = "|".join(["route", *(f"{v:.5f}" for v in (*origin, *destination))])
    return _demo_cached(key, lambda: _google_track(origin, destination))


def decode_polyline(encoded: str) -> list[LatLng]:
    """Google's encoded polyline format (precision 5) -> [(lat, lng), ...]."""
    values, value, shift = [], 0, 0
    for byte in encoded.encode():
        chunk = byte - 63
        value |= (chunk & 0x1F) << shift
        shift += 5
        if chunk < 0x20:
            values.append(~(value >> 1) if value & 1 else value >> 1)
            value, shift = 0, 0
    lat = lng = 0
    points = []
    for dlat, dlng in zip(values[::2], values[1::2], strict=True):
        lat, lng = lat + dlat, lng + dlng
        points.append((lat / 1e5, lng / 1e5))
    return points


def distance_m(a: LatLng, b: LatLng) -> float:
    """Great-circle distance in meters."""
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _point(p: LatLng) -> dict:
    return {"location": {"latLng": {"latitude": p[0], "longitude": p[1]}}}


def _google(origin: LatLng, destination: LatLng, t: datetime | None = None) -> float:
    """t=None departs now (Google's default)."""
    body = {
        "origin": _point(origin),
        "destination": _point(destination),
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
    }
    if t is not None:
        body["departureTime"] = t.isoformat()
    res = _post(
        GOOGLE_URL,
        body,
        {
            "X-Goog-Api-Key": get_settings().google_maps_key,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
    )
    try:
        return float(res["routes"][0]["duration"].removesuffix("s")) / 60
    except (KeyError, IndexError, ValueError) as e:
        raise RoutingError(f"google: no route in response {res!r}") from e


def _google_track(origin: LatLng, destination: LatLng) -> tuple[list[LatLng], list[float]]:
    body = {
        "origin": _point(origin),
        "destination": _point(destination),
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_UNAWARE",
    }
    mask = "routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.staticDuration"
    headers = {"X-Goog-Api-Key": get_settings().google_maps_key, "X-Goog-FieldMask": mask}
    res = _post(GOOGLE_URL, body, headers)
    try:
        steps = [step for leg in res["routes"][0]["legs"] for step in leg["steps"]]
    except (KeyError, IndexError) as e:
        raise RoutingError(f"google: no route in response {res!r}") from e
    points, minutes = [origin], [0.0]
    for step in steps:
        pts = decode_polyline(step["polyline"]["encodedPolyline"])
        dur = float(step.get("staticDuration", "0s").removesuffix("s")) / 60
        legs = [distance_m(a, b) for a, b in zip([points[-1], *pts[:-1]], pts, strict=True)]
        total = sum(legs) or 1.0
        for p, d in zip(pts, legs, strict=True):
            points.append(p)
            minutes.append(minutes[-1] + dur * d / total)
    return points, minutes


def _ors(origin: LatLng, destination: LatLng) -> float:
    body = {"coordinates": [[origin[1], origin[0]], [destination[1], destination[0]]]}  # [lng, lat]
    res = _post(ORS_URL, body, {"Authorization": get_settings().ors_api_key})
    try:
        return float(res["routes"][0]["summary"]["duration"]) / 60
    except (KeyError, IndexError, ValueError) as e:
        raise RoutingError(f"ors: no route in response {res!r}") from e


def _google_geocode(address: str) -> LatLng:
    params = {"address": address, "region": "us", "key": get_settings().google_maps_key}
    res = _get(GEOCODE_URL, params)
    if res.get("status") != "OK":
        detail = res.get("error_message") or res.get("status")
        raise RoutingError(f"google: can't find {address!r}: {detail}")
    loc = res["results"][0]["geometry"]["location"]
    return loc["lat"], loc["lng"]


def _drive(name: str, origin: LatLng, destination: LatLng) -> float:
    """Untimed drive minutes from OpenRouteService, or OSRM. When OpenRouteService fails (its
    free daily quota runs out), OSRM answers instead: both are untimed, so the numbers agree."""
    if name == "osrm":
        return _osrm(origin, destination)
    try:
        return _ors(origin, destination)
    except RoutingError as e:
        log.warning("openrouteservice failed, asking osrm: %s", e)
        return _osrm(origin, destination)


def _osrm(origin: LatLng, destination: LatLng) -> float:
    url = f"{OSRM_URL}/{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
    res = _get(url, {"overview": "false"})
    try:
        return float(res["routes"][0]["duration"]) / 60
    except (KeyError, IndexError, ValueError) as e:
        raise RoutingError(f"osrm: no route in response {res!r}") from e


def _ors_geocode(address: str) -> LatLng:
    params = {
        "text": address,
        "size": 1,
        "boundary.country": "US",
        "api_key": get_settings().ors_api_key,
    }
    res = _get(ORS_GEOCODE_URL, params)
    try:
        lng, lat = res["features"][0]["geometry"]["coordinates"]
    except (KeyError, IndexError, ValueError) as e:
        raise RoutingError(f"ors: can't find {address!r}") from e
    return lat, lng


def _post(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers}
    )
    return _fetch(req, url)


def _get(url: str, params: dict) -> dict:
    return _fetch(urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}"), url)


def _fetch(req: urllib.request.Request, url: str) -> dict:
    """The JSON response. Errors name url, not the full request URL, which may hold a key."""
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RoutingError(f"{url}: HTTP {e.code}: {e.read()[:300]!r}") from e
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise RoutingError(f"{url}: {e}") from e


def _cached(key: str, max_age_days: float, fetch):
    """fetch(), kept in the temporary on-disk cache for max_age_days."""
    with _lock:
        hit = _load().get(key)
    if hit and "value" in hit and time.time() - hit["at"] < max_age_days * 86400:
        return hit["value"]
    value = fetch()
    with _lock:
        cache = _load()
        cache[key] = {"value": value, "at": time.time()}
        _save(cache, max_age_days)
    return value


@contextlib.contextmanager
def replaying():
    """Record and replay live and route answers inside the block as with DEMO_CACHE=1.

    Yields the list of keys that weren't recorded yet and were fetched live, so a rehearsed demo
    can check it never needs one. Each miss is also logged.
    """
    misses: list[str] = []
    token = _replay_misses.set(misses)
    try:
        yield misses
    finally:
        _replay_misses.reset(token)


def _demo_cached(key: str, fetch):
    """fetch(), recorded in / replayed from DEMO_CACHE_PATH when DEMO_CACHE=1 or replaying()."""
    settings = get_settings()
    misses = _replay_misses.get()
    if not settings.demo_cache and misses is None:
        return fetch()
    path = Path(settings.demo_cache_path)
    with _lock:
        cache = _read(path)
    if key in cache:
        hit = cache[key]
        return (list(map(tuple, hit[0])), hit[1]) if isinstance(hit, list) else hit
    if misses is not None:
        misses.append(key)
        log.warning("demo replay: no recorded answer for %s, asking %s live", key, provider())
    value = fetch()
    with _lock:
        cache = _read(path)
        cache[key] = value
        _write(path, cache)
    return value


def _read(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):  # the cache is only a speed-up: carry on without it
        return {}


def _write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data))
        tmp.replace(path)
    except OSError:  # e.g. a read-only deploy: the lookup itself still succeeded
        pass


def _cache_path() -> Path:
    return Path(get_settings().drive_cache_path)


def _load() -> dict:
    return _read(_cache_path())


def _save(cache: dict, max_age_days: float) -> None:
    cutoff = time.time() - max_age_days * 86400
    _write(_cache_path(), {k: v for k, v in cache.items() if v["at"] >= cutoff})
