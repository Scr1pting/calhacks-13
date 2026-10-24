"""Bridge between the delay model (app.prediction) and the agents and API.

Everything numeric the rider sees comes through here, so the agents only ever
choose between numbers the model produced. A pickup time is the start of the
provider's 30-min pickup window. These functions are synchronous and can be
slow (routing calls); async callers run them with asyncio.to_thread so the
server stays responsive.
"""

import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.core.schemas import Trip, TripOption
from app.core.store import get_store
from app.prediction import plan
from app.prediction.plan import ModelUnavailable

__all__ = ["DelayAssessment", "ModelUnavailable"]


def model_ride(trip: Trip) -> plan.Ride:
    grace = trip.policy.grace_minutes if trip.policy else 0
    arrive_by = plan.aware(trip.arrive_by)
    return plan.Ride(
        origin=trip.origin,
        dest=trip.dest,
        arrive_by=arrive_by,
        deadline=arrive_by + timedelta(minutes=grace),
    )


def _option(s: plan.Score) -> TripOption:
    return TripOption(
        pickup_time=s.window_start,
        p_on_time=round(s.p_on_time, 3),
        expected_wait_minutes=round(s.expected_wait_min, 1),
    )


def tradeoff(trip: Trip) -> list[TripOption]:
    return [_option(s) for s in plan.tradeoff(model_ride(trip))]


def options(trip: Trip, certainty: float) -> list[TripOption]:
    return [_option(s) for s in plan.options(model_ride(trip), certainty)]


def distribution(trip: Trip, pickup_time: datetime) -> dict:
    """Arrival histogram for one pickup time: P(arrival) per 5-min bin."""
    edges, p = plan.histogram(model_ride(trip), plan.aware(pickup_time))
    return {"bin_edges": edges, "p": [round(x, 4) for x in p]}


@dataclass
class DelayAssessment:
    p_on_time: float  # chance of arriving by arrive_by + grace
    expected_arrival: datetime  # median
    minutes_late: int  # median arrival minus arrive_by, never negative
    deadline: datetime


def assess_delay(trip: Trip, at: datetime) -> DelayAssessment:
    """Arrival outlook for a booked trip, given what we know about the van right now."""
    if trip.booked_pickup is None:
        raise ValueError("trip is not booked")
    ride = model_ride(trip)
    live = trip.live
    p, median = plan.outlook(
        ride,
        plan.aware(trip.booked_pickup),
        plan.aware(at),
        live.van_eta and plan.aware(live.van_eta),
        live.picked_up_at and plan.aware(live.picked_up_at),
    )
    late_min = max(0, round((median - ride.arrive_by).total_seconds() / 60))
    return DelayAssessment(
        p_on_time=round(p, 3),
        expected_arrival=median,
        minutes_late=late_min,
        deadline=ride.deadline,
    )


def promised_p_on_time(trip: Trip) -> float:
    if trip.plan and trip.booked_pickup:
        for o in trip.plan.tradeoff + trip.plan.options:
            if o.pickup_time == trip.booked_pickup:
                return o.p_on_time
    return float("nan")


def record_completed_trip(trip: Trip) -> None:
    """Log a finished trip, for calibration."""
    live = trip.live
    if not (trip.booked_pickup and live.picked_up_at and live.arrived_at):
        return
    grace = trip.policy.grace_minutes if trip.policy else 0
    store = get_store()
    logs = store.get_json("trip_logs") or []
    logs.append({
        "trip": {
            "origin": trip.origin,
            "dest": trip.dest,
            "arrive_by": trip.arrive_by,
            "grace": grace * 60.0,  # seconds
        },
        "booked_pickup": trip.booked_pickup,
        "actual_pickup": live.picked_up_at,
        "actual_arrival": live.arrived_at,
        "promised_p_on_time": promised_p_on_time(trip),
    })
    store.put_json("trip_logs", logs)


def calibration() -> list[dict]:
    """(promised, observed) on-time rates, grouped by promised certainty to one decimal."""
    buckets: dict[float, list[bool]] = {}
    for log in get_store().get_json("trip_logs") or []:
        promised = float(log["promised_p_on_time"])
        if promised != promised:  # NaN: booked at a time the plan didn't score
            continue
        t = log["trip"]
        deadline = plan.aware(datetime.fromisoformat(t["arrive_by"]))
        deadline += timedelta(seconds=float(t["grace"]))
        on_time = plan.aware(datetime.fromisoformat(log["actual_arrival"])) <= deadline
        buckets.setdefault(round(promised, 1), []).append(on_time)
    return [{"promised": p, "observed": statistics.mean(v)} for p, v in sorted(buckets.items())]
