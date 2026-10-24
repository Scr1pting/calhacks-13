"""Bridge between the delay model (app.model) and the agents and API.

Everything numeric the rider sees comes through here, so the agents only ever
choose between numbers the model produced. These functions are synchronous and
can be slow; async callers run them with asyncio.to_thread so the server stays
responsive.
"""

import statistics
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.core.config import get_settings
from app.core.schemas import Trip, TripOption
from app.core.store import get_store
from app.model import types as mt

N_SAMPLES = 2000


class ModelUnavailable(RuntimeError):
    pass


def _backend() -> SimpleNamespace:
    if get_settings().model_backend == "real":
        from app.model import decision, evaluation, priors, routes, simulation

        modules = (routes, priors, simulation, decision, evaluation)
    else:
        from app.tools import fake_model

        modules = (fake_model,)
    ns = SimpleNamespace()
    for module in modules:
        for name in dir(module):
            if not name.startswith("_"):
                setattr(ns, name, getattr(module, name))
    return ns


def _call(name: str, *args):
    try:
        return getattr(_backend(), name)(*args)
    except NotImplementedError as e:
        raise ModelUnavailable(f"delay model function {name}() is not implemented yet") from e


def model_trip(trip: Trip) -> mt.Trip:
    grace = trip.policy.grace_minutes if trip.policy else 0
    return mt.Trip(
        origin=trip.origin,
        dest=trip.dest,
        arrive_by=trip.arrive_by,
        grace=timedelta(minutes=grace),
    )


def _minutes(td: timedelta) -> float:
    return round(td.total_seconds() / 60, 1)


def load_priors() -> mt.Priors:
    saved = get_store().get_json("priors")
    return mt.Priors(**saved) if saved else _call("default_priors")


def tradeoff(trip: Trip) -> list[TripOption]:
    rows = _call("tradeoff", model_trip(trip))
    return [
        TripOption(pickup_time=t, p_on_time=round(p, 3), expected_wait_minutes=_minutes(w))
        for t, p, w in rows
    ]


def options(trip: Trip, certainty: float) -> list[TripOption]:
    return [
        TripOption(
            pickup_time=o.pickup_time,
            p_on_time=round(o.p_on_time, 3),
            expected_wait_minutes=_minutes(o.expected_wait),
        )
        for o in _call("options", model_trip(trip), certainty)
    ]


def distribution(trip: Trip, pickup_time: datetime) -> dict:
    d = _call("distribution", model_trip(trip), pickup_time)
    return {
        "bin_edges": d.bin_edges,
        "counts": d.counts,
        "components": {k: [_minutes(v) for v in vs] for k, vs in d.components.items()},
    }


@dataclass
class DelayAssessment:
    p_on_time: float  # chance of arriving by arrive_by + grace
    expected_arrival: datetime  # median
    minutes_late: int  # median arrival minus arrive_by, never negative
    deadline: datetime


def assess_delay(trip: Trip, at: datetime) -> DelayAssessment:
    """Arrival outlook for a booked trip, given what we know about the van right now.

    The model interface has no way to condition on live data, so this takes the
    per-sample components from distribution() and replaces the pickup lateness
    with what has actually been observed.
    """
    if trip.booked_pickup is None:
        raise ValueError("trip is not booked")
    m = model_trip(trip)
    booked = trip.booked_pickup
    live = trip.live
    known = None
    if live.picked_up_at:
        known = live.picked_up_at - booked
    elif live.van_eta:
        known = live.van_eta - booked

    comps = _call("distribution", m, booked).components
    if "pickup_lateness" in comps:
        late = comps["pickup_lateness"]
        rest = [sum(parts, timedelta(0)) for parts in zip(
            *(v for k, v in comps.items() if k != "pickup_lateness"), strict=True
        )]
        overdue = at - booked
        arrivals = []
        for lateness, other in zip(late, rest, strict=True):
            if known is not None:
                lateness = known
            elif overdue > lateness:
                lateness = overdue  # the van hasn't shown up yet, so it's at least this late
            arrivals.append(booked + lateness + other)
    else:
        start = booked + known if known is not None else max(booked, at)
        arrivals = _call("simulate_arrivals", m, start, load_priors(), N_SAMPLES)

    p = _call("p_on_time", arrivals, m.deadline)
    median = datetime.fromtimestamp(
        statistics.median(a.timestamp() for a in arrivals), tz=booked.tzinfo
    )
    late_min = max(0, round((median - trip.arrive_by).total_seconds() / 60))
    return DelayAssessment(
        p_on_time=round(p, 3), expected_arrival=median, minutes_late=late_min, deadline=m.deadline
    )


def promised_p_on_time(trip: Trip) -> float:
    if trip.plan and trip.booked_pickup:
        for o in trip.plan.tradeoff + trip.plan.options:
            if o.pickup_time == trip.booked_pickup:
                return o.p_on_time
    return float("nan")


def record_completed_trip(trip: Trip) -> None:
    """Feed a finished trip back into the priors so estimates improve."""
    live = trip.live
    if not (trip.booked_pickup and live.picked_up_at and live.arrived_at):
        return
    store = get_store()
    log = mt.TripLog(
        trip=model_trip(trip),
        booked_pickup=trip.booked_pickup,
        actual_pickup=live.picked_up_at,
        actual_arrival=live.arrived_at,
        promised_p_on_time=promised_p_on_time(trip),
    )
    logs = store.get_json("trip_logs") or []
    logs.append(_log_to_json(log))
    store.put_json("trip_logs", logs)
    try:
        priors = _call("update_priors", load_priors(), [log])
    except ModelUnavailable:
        return
    store.put_json("priors", asdict(priors))


def _log_to_json(log: mt.TripLog) -> dict:
    d = asdict(log)
    d["trip"]["grace"] = log.trip.grace.total_seconds()
    return d


def _log_from_json(d: dict) -> mt.TripLog:
    t = d["trip"]
    trip = mt.Trip(
        origin=t["origin"],
        dest=t["dest"],
        arrive_by=datetime.fromisoformat(t["arrive_by"]),
        grace=timedelta(seconds=float(t["grace"])),
    )
    return mt.TripLog(
        trip=trip,
        booked_pickup=datetime.fromisoformat(d["booked_pickup"]),
        actual_pickup=datetime.fromisoformat(d["actual_pickup"]),
        actual_arrival=datetime.fromisoformat(d["actual_arrival"]),
        promised_p_on_time=float(d["promised_p_on_time"]),
    )


def calibration() -> list[dict]:
    logs = [_log_from_json(d) for d in get_store().get_json("trip_logs") or []]
    logs = [log for log in logs if log.promised_p_on_time == log.promised_p_on_time]  # drop NaN
    if not logs:
        return []
    return [{"promised": p, "observed": o} for p, o in _call("calibration", logs)]
