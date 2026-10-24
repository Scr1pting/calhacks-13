"""Changes to a trip that both the API and the chat agent can make, with the same checks."""

from datetime import datetime

from app.agents import monitor, planner
from app.core import bus
from app.core.jobs import spawn
from app.core.schemas import AppointmentPolicy, Permissions, Trip, TripRequest, TripStatus
from app.core.store import get_store


class TripOpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def get(trip_id: str) -> Trip:
    trip = get_store().get_trip(trip_id)
    if trip is None:
        raise TripOpError(404, "trip not found")
    return trip


def create(request: TripRequest) -> Trip:
    """A new trip: save it, start the planner, and tell the rider's app it exists."""
    trip = Trip(**request.model_dump())
    get_store().put_trip(trip)
    spawn(planner.plan_trip(trip.id), name=f"plan:{trip.id}")
    if trip.rider_id:
        bus.publish(trip.rider_id, "trips", trip.model_dump_json())
    return trip


def start_planning(trip_id: str, certainty: float | None = None) -> Trip:
    trip = get(trip_id)
    if trip.status not in (TripStatus.planned, TripStatus.failed):
        raise TripOpError(409, f"cannot replan a trip that is {trip.status}")

    def change(t: Trip):
        t.status = TripStatus.planning
        if certainty is not None:
            t.certainty = certainty

    trip = get_store().update_trip(trip_id, change)
    spawn(planner.plan_trip(trip_id), name=f"plan:{trip_id}")
    return trip


def book(trip_id: str, pickup_time: datetime) -> Trip:
    """The rider confirms a pickup time. It must be one the model scored."""
    trip = get(trip_id)
    if trip.plan is None:
        raise TripOpError(409, "trip has no plan yet")
    if trip.status not in (TripStatus.planned, TripStatus.booked):
        raise TripOpError(409, f"cannot book a trip that is {trip.status}")
    if pickup_time not in {o.pickup_time for o in trip.plan.tradeoff + trip.plan.options}:
        raise TripOpError(422, "pickup_time must be one of the plan's options")

    def change(t: Trip):
        t.booked_pickup = pickup_time
        t.status = TripStatus.booked

    trip = get_store().update_trip(trip_id, change)
    get_store().log(trip_id, "booked", f"Booked pickup for {pickup_time.isoformat()}.")
    return trip


def set_policy(trip_id: str, policy: AppointmentPolicy) -> Trip:
    """The rider already knows the appointment's late policy. Replan afterwards to use it."""
    get(trip_id)
    policy.source = "rider"
    trip = get_store().update_trip(trip_id, lambda t: setattr(t, "policy", policy))
    get_store().log(trip_id, "policy_set", "Rider entered the appointment's late policy.",
                    policy=policy.model_dump())
    return trip


def update_permissions(trip_id: str, **changes) -> Trip:
    get(trip_id)
    changes = {k: v for k, v in changes.items() if v is not None}

    def change(t: Trip):
        t.permissions = Permissions(**{**t.permissions.model_dump(), **changes})

    trip = get_store().update_trip(trip_id, change)
    get_store().log(trip_id, "permissions_changed", "Rider changed what the agent may do.",
                    changes=changes)
    return trip


def change_appointment_time(trip_id: str, arrive_by: datetime) -> Trip:
    """The appointment moved: before pickup that means a new plan, during the ride a new outlook."""
    trip = get(trip_id)
    if trip.status in (TripStatus.planning, TripStatus.completed):
        raise TripOpError(409, f"cannot change the time of a trip that is {trip.status}")
    if arrive_by.tzinfo is None:
        arrive_by = arrive_by.replace(tzinfo=trip.arrive_by.tzinfo)
    riding = trip.status == TripStatus.riding

    def change(t: Trip):
        t.arrive_by = arrive_by
        t.late_notice = None
        t.outlook = None
        if not riding:  # the old plan and booking were for the old time
            t.plan = None
            t.booked_pickup = None
            t.status = TripStatus.planning

    trip = get_store().update_trip(trip_id, change)
    get_store().log(trip_id, "appointment_moved",
                    f"Appointment moved to {arrive_by.isoformat()}.")
    if riding:
        spawn(monitor.check_trip(trip_id), name=f"check:{trip_id}")
    else:
        spawn(planner.plan_trip(trip_id), name=f"plan:{trip_id}")
    return trip
