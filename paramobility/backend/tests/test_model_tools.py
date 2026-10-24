from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import get_settings
from app.core.schemas import AppointmentPolicy, LiveStatus
from app.prediction import plan, routing
from app.tools import model_tools
from app.tools.model_tools import ModelUnavailable

REAL_DRIVE_MINUTES = plan.drive_minutes  # before conftest stubs it


def test_options_meet_the_requested_certainty(trip):
    opts = model_tools.options(trip, 0.9)
    assert opts
    assert all(o.p_on_time >= 0.9 for o in opts)
    assert opts == sorted(opts, key=lambda o: o.pickup_time, reverse=True)  # least waiting first


def test_candidates_are_windows_on_the_clock_grid(trip):
    rows = model_tools.tradeoff(trip)
    times = [o.pickup_time for o in rows]
    assert times == sorted(times)
    assert times[-1] == trip.arrive_by - timedelta(minutes=5)
    assert times[0] == trip.arrive_by - timedelta(minutes=plan.MAX_BACK)
    assert all(t.minute % 5 == 0 and t.second == 0 for t in times)
    assert all(t.tzinfo == trip.arrive_by.tzinfo for t in times)


def test_no_windows_before_service_starts(trip):
    trip.arrive_by = datetime(2026, 11, 3, 6, 0, tzinfo=routing.TZ)
    times = [o.pickup_time for o in model_tools.tradeoff(trip)]
    assert times[0].astimezone(routing.TZ).hour == 5
    assert len(times) == 12


def test_later_windows_mean_less_waiting_and_less_certainty(trip):
    rows = model_tools.tradeoff(trip)
    waits = [o.expected_wait_minutes for o in rows]
    assert waits == sorted(waits, reverse=True)
    assert rows[0].p_on_time > rows[-1].p_on_time


def test_grace_period_raises_the_chance_of_being_on_time(trip):
    pickup = model_tools.tradeoff(trip)[-1].pickup_time
    before = {o.pickup_time: o.p_on_time for o in model_tools.tradeoff(trip)}[pickup]
    trip.policy = AppointmentPolicy(grace_minutes=15)
    after = {o.pickup_time: o.p_on_time for o in model_tools.tradeoff(trip)}[pickup]
    assert after > before


def test_van_no_show_makes_the_outlook_worse(trip):
    trip.booked_pickup = model_tools.options(trip, 0.9)[0].pickup_time
    on_time = model_tools.assess_delay(trip, trip.booked_pickup)
    overdue = model_tools.assess_delay(trip, trip.booked_pickup + timedelta(minutes=45))
    assert overdue.p_on_time < on_time.p_on_time
    assert overdue.minutes_late > on_time.minutes_late


def test_late_pickup_is_taken_from_live_status(trip):
    trip.booked_pickup = model_tools.options(trip, 0.9)[0].pickup_time
    trip.live = LiveStatus(picked_up_at=trip.arrive_by - timedelta(minutes=10))
    a = model_tools.assess_delay(trip, trip.live.picked_up_at)
    assert a.minutes_late > 0
    assert a.p_on_time < 0.5


def test_a_long_ride_lowers_the_outlook(trip):
    trip.booked_pickup = model_tools.options(trip, 0.9)[0].pickup_time
    trip.live = LiveStatus(picked_up_at=trip.booked_pickup)
    start = model_tools.assess_delay(trip, trip.booked_pickup)
    later = model_tools.assess_delay(trip, trip.booked_pickup + timedelta(minutes=60))
    assert later.p_on_time < start.p_on_time
    assert later.expected_arrival > start.expected_arrival


def test_distribution_sums_to_one(trip):
    pickup = model_tools.options(trip, 0.9)[0].pickup_time
    d = model_tools.distribution(trip, pickup)
    assert len(d["bin_edges"]) == len(d["p"]) + 1
    assert sum(d["p"]) == pytest.approx(1, abs=0.01)


def test_drive_time_geocodes_the_addresses(monkeypatch):
    places = {"home": (37.80, -122.27), "clinic": (37.87, -122.26)}
    seen = []
    monkeypatch.setattr(routing, "geocode", lambda address: places[address])

    def drive_minutes(origin, dest, depart):
        seen.append((origin, dest, depart))
        return 12.0

    monkeypatch.setattr(routing, "drive_minutes", drive_minutes)
    depart = datetime(2026, 11, 3, 21, 0, tzinfo=UTC)
    ride = plan.Ride("home", "clinic", depart, depart)
    assert REAL_DRIVE_MINUTES(ride, depart) == 12.0
    assert seen == [(places["home"], places["clinic"], depart)]


def test_missing_routing_key_is_reported(trip, monkeypatch):
    monkeypatch.setattr(plan, "drive_minutes", REAL_DRIVE_MINUTES)
    get_settings.cache_clear()
    with pytest.raises(ModelUnavailable, match="no routing key"):
        model_tools.tradeoff(trip)
