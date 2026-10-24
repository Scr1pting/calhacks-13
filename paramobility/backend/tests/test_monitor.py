from datetime import timedelta

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
