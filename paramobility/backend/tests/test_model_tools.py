from datetime import timedelta

import pytest

from app.core.schemas import AppointmentPolicy, LiveStatus
from app.tools import model_tools
from app.tools.model_tools import ModelUnavailable


def test_options_meet_the_requested_certainty(trip):
    opts = model_tools.options(trip, 0.9)
    assert opts
    assert all(o.p_on_time >= 0.9 for o in opts)


def test_grace_period_raises_the_chance_of_being_on_time(trip, store):
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
    trip.live = LiveStatus(picked_up_at=trip.booked_pickup + timedelta(minutes=60))
    a = model_tools.assess_delay(trip, trip.live.picked_up_at)
    assert a.minutes_late > 0
    assert a.p_on_time < 0.5


def test_unimplemented_real_model_is_reported(trip, monkeypatch):
    monkeypatch.setenv("MODEL_BACKEND", "real")
    from app.core import config

    config.get_settings.cache_clear()
    with pytest.raises(ModelUnavailable):
        model_tools.tradeoff(trip)
