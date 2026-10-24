"""Stand-in for app.model with the same function signatures.

Used while MODEL_BACKEND=fake so the agents can run before the real delay model
lands. The numbers are plausible but made up: pickup lateness is roughly normal,
traffic scales the drive time, and shared-ride detours are exponential.
"""

import hashlib
import random
import statistics
from datetime import datetime, timedelta

from app.model.types import Distribution, Priors, Samples, Trip, TripLog, TripOption

N_SAMPLES = 2000
SLOT = timedelta(minutes=5)


def _seed(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


# routes

def drive_time(
    origin: str, dest: str, depart: datetime
) -> tuple[timedelta, timedelta, timedelta]:
    best = timedelta(minutes=15 + _seed(origin, dest) % 25)
    if 7 <= depart.hour < 10 or 16 <= depart.hour < 19:
        best *= 1.3  # rush hour
    return best * 0.8, best, best * 1.6


# priors

def default_priors() -> Priors:
    return Priors(
        pickup_lateness={"mean_min": 12.0, "sd_min": 10.0, "earliest_min": -5.0},
        traffic={"sd_frac": 0.2},
        detour={"mean_min": 8.0},
    )


def update_priors(priors: Priors, trip_log: list[TripLog]) -> Priors:
    if not trip_log:
        return priors
    observed = [(t.actual_pickup - t.booked_pickup).total_seconds() / 60 for t in trip_log]
    n = priors.n_trips + len(trip_log)
    mean = priors.pickup_lateness["mean_min"]
    mean += (sum(observed) - len(observed) * mean) / n
    return Priors(
        pickup_lateness={**priors.pickup_lateness, "mean_min": mean},
        traffic=priors.traffic,
        detour=priors.detour,
        n_trips=n,
    )


# simulation

def _components(trip: Trip, pickup_time: datetime, priors: Priors, n: int):
    rng = random.Random(_seed(trip.origin, trip.dest, pickup_time.isoformat()))
    _, best, _ = drive_time(trip.origin, trip.dest, pickup_time)
    pl, tr, dt = priors.pickup_lateness, priors.traffic, priors.detour
    lateness, drive, detour = [], [], []
    for _ in range(n):
        late_min = max(pl["earliest_min"], rng.gauss(pl["mean_min"], pl["sd_min"]))
        lateness.append(timedelta(minutes=late_min))
        drive.append(best * max(0.7, rng.lognormvariate(0, tr["sd_frac"])))
        detour.append(timedelta(minutes=rng.expovariate(1 / dt["mean_min"])))
    return {"pickup_lateness": lateness, "drive": drive, "detour": detour}


def simulate_arrivals(trip: Trip, pickup_time: datetime, priors: Priors, n: int) -> Samples:
    c = _components(trip, pickup_time, priors, n)
    return [
        pickup_time + a + b + d
        for a, b, d in zip(c["pickup_lateness"], c["drive"], c["detour"], strict=True)
    ]


def p_on_time(samples: Samples, deadline: datetime) -> float:
    return sum(s <= deadline for s in samples) / len(samples)


def expected_wait(samples: Samples, arrive_by: datetime) -> timedelta:
    waits = [max(arrive_by - s, timedelta(0)) for s in samples]
    return sum(waits, timedelta(0)) / len(waits)


# decision

def tradeoff(trip: Trip) -> list[tuple[datetime, float, timedelta]]:
    priors = default_priors()
    rows = []
    pickup = trip.arrive_by - timedelta(minutes=150)
    while pickup <= trip.arrive_by - timedelta(minutes=15):
        samples = simulate_arrivals(trip, pickup, priors, N_SAMPLES)
        rows.append(
            (pickup, p_on_time(samples, trip.deadline), expected_wait(samples, trip.arrive_by))
        )
        pickup += SLOT
    return rows


def options(trip: Trip, certainty: float) -> list[TripOption]:
    ok = [r for r in tradeoff(trip) if r[1] >= certainty]
    ok.sort(key=lambda r: r[0], reverse=True)  # latest pickup = least waiting
    return [TripOption(pickup_time=t, p_on_time=p, expected_wait=w) for t, p, w in ok[:3]]


# evaluation

def distribution(trip: Trip, pickup_time: datetime) -> Distribution:
    c = _components(trip, pickup_time, default_priors(), N_SAMPLES)
    arrivals = sorted(
        pickup_time + a + b + d
        for a, b, d in zip(c["pickup_lateness"], c["drive"], c["detour"], strict=True)
    )
    start = arrivals[0].replace(second=0, microsecond=0)
    edges = [start]
    while edges[-1] <= arrivals[-1]:
        edges.append(edges[-1] + SLOT)
    counts = [0] * (len(edges) - 1)
    for a in arrivals:
        counts[min(int((a - start) / SLOT), len(counts) - 1)] += 1
    return Distribution(bin_edges=edges, counts=counts, components=c)


def calibration(logs: list[TripLog]) -> list[tuple[float, float]]:
    buckets: dict[float, list[bool]] = {}
    for log in logs:
        key = round(log.promised_p_on_time, 1)
        buckets.setdefault(key, []).append(log.actual_arrival <= log.trip.deadline)
    return [(k, statistics.mean(v)) for k, v in sorted(buckets.items())]
