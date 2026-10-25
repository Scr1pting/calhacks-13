from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.agents import monitor
from app.agents.monitor import needs_notice
from app.core.schemas import LateNotice
from app.tools.model_tools import DelayAssessment


def assessment(arrive_by, p, minutes_late):
    return DelayAssessment(
        p_on_time=p,
        expected_arrival=arrive_by + timedelta(minutes=minutes_late),
        minutes_late=minutes_late,
        deadline=arrive_by,
    )


def test_no_notice_while_likely_on_time(trip, arrive_by):
    assert not needs_notice(trip, assessment(arrive_by, 0.8, 0))


def test_notice_once_likely_late(trip, arrive_by):
    assert needs_notice(trip, assessment(arrive_by, 0.3, 12))


def test_follow_up_only_when_delay_grows(trip, arrive_by):
    trip.late_notice = LateNotice(sent_at=arrive_by, minutes_late=12)
    assert not needs_notice(trip, assessment(arrive_by, 0.2, 18))
    assert needs_notice(trip, assessment(arrive_by, 0.1, 22))


def test_a_call_that_agreed_a_later_time_moves_the_appointment():
    from types import SimpleNamespace

    booked = datetime(2026, 10, 25, 11, 19, tzinfo=ZoneInfo("America/Los_Angeles"))
    trip = SimpleNamespace(arrive_by=booked)
    assert monitor.moved_to(trip, {"new_time": "11:45"}) == booked.replace(minute=45)
    assert monitor.moved_to(trip, {"new_time": "13:05"}) == booked.replace(hour=13, minute=5)
    # Earlier than booked, nonsense, or nothing: not moved.
    for raw in ("10:30", "25:00", "soon", "", None):
        assert monitor.moved_to(trip, {"new_time": raw}) is None
    assert monitor.moved_to(trip, None) is None
    said = monitor.call_summary("t", "Highland", 5, {"reached_someone": True, "new_time": "13:05"})
    assert said.endswith("They moved your appointment to 1:05 PM.")
