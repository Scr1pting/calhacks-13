import itertools
import math

import pytest

from app.prediction import live, onboard, ride, routing, sim
from app.prediction.onboard import OnboardState

DEST = (37.8, -122.2)
APPT = 14 * 60.0


def east_of(p, meters):
    return p[0], p[1] + meters / (111_320 * math.cos(math.radians(p[0])))


def state(**kw):
    return OnboardState("t1", APPT, DEST, **kw)


def test_full_ride_left_matches_ride_model():
    s = state()
    m = onboard.onboard_status(s, 13 * 60, 25.0, east_of(DEST, -15_000))
    assert m["f"] == 1.0
    assert m["mean"] == pytest.approx(ride.ride_time(25.0).mean(), rel=1e-9)


def test_f_never_increases_and_detour_flagged():
    s = state()
    start = east_of(DEST, -15_000)
    onboard.onboard_status(s, 780, 30.0, start)
    onboard.onboard_status(s, 785, 24.0, east_of(start, 3000))
    assert s.prev_f == pytest.approx(0.8) and not s.detour
    m = onboard.onboard_status(s, 787, 27.0, east_of(start, 2500))  # +3 min after moving 500 m
    assert s.prev_f == pytest.approx(0.8) and m["f"] == pytest.approx(0.8)
    assert s.detour
    # a timer poll with little movement keeps the flag; back on route clears it
    onboard.onboard_status(s, 789, 27.5, east_of(start, 2550))
    assert s.detour
    onboard.onboard_status(s, 791, 24.5, east_of(start, 3100))
    assert not s.detour and s.prev_f == pytest.approx(0.8)


def test_no_detour_without_movement():
    s = state()
    p = east_of(DEST, -10_000)
    onboard.onboard_status(s, 780, 20.0, p)
    onboard.onboard_status(s, 782, 23.0, east_of(p, 50))  # traffic got worse while standing
    assert not s.detour


@pytest.mark.parametrize("drive", [0.0, 1e-6, 0.01])
def test_at_the_door(drive):
    s = state()
    onboard.onboard_status(s, 780, 30.0, east_of(DEST, -15_000))
    m = onboard.onboard_status(s, 830, drive, DEST)
    assert m["p_on_time"] == pytest.approx(1.0)
    assert m["eta"] == pytest.approx(830, abs=0.1)


def test_should_poll():
    s = state()
    p = east_of(DEST, -10_000)
    assert onboard.should_poll(s, 780, p)  # first fix
    s.last_attempt_t = s.last_call_t = 780
    s.last_call_pos = p
    assert not onboard.should_poll(
        s, 780 + 20 / 60, east_of(p, 1000)
    )  # 30-s minimum, even after moving
    assert not onboard.should_poll(s, 780 + 20 / 60, p, refresh=True)
    assert onboard.should_poll(s, 780 + 31 / 60, p, refresh=True)
    assert onboard.should_poll(s, 780 + 31 / 60, east_of(p, 310))  # moved 300 m
    assert not onboard.should_poll(s, 780 + 110 / 60, east_of(p, 200))
    assert onboard.should_poll(s, 780 + 121 / 60, east_of(p, 200))  # 2-min maximum


def test_displayed_eta_moves_in_steps_of_2_min():
    s = state()
    onboard.update_display(s, {"eta": 830.0, "p_on_time": 0.95})
    assert s.eta_displayed == 830.0
    onboard.update_display(s, {"eta": 832.0, "p_on_time": 0.95})  # smoothed 831: < 2 min
    assert s.eta_displayed == 830.0
    onboard.update_display(s, {"eta": 834.0, "p_on_time": 0.95})  # smoothed 832.5
    assert s.eta_displayed == 832.5


def test_alert_once_per_crossing_with_hysteresis():
    s = state()
    fired = []
    for p in (0.9, 0.65, 0.6, 0.75, 0.65, 0.85, 0.85, 0.85, 0.6):
        before = s.alert
        onboard.update_display(s, {"eta": 830.0, "p_on_time": p})
        fired.append(s.alert is not None and s.alert is not before)
    assert fired == [False, True, False, False, False, False, False, False, True]
    assert s.alert["type"] == "running_late" and "late?" in s.alert["message"]


def test_alert_when_eta_passes_appointment_plus_5():
    s = state()
    onboard.update_display(s, {"eta": APPT + 12, "p_on_time": 0.75})
    assert s.alert == {
        "type": "running_late",
        "minutes": 10,
        "message": "Tell the clinic you'll be about 10 min late?",
    }


def test_routing_failure_is_stale(monkeypatch):
    s = state()
    p = east_of(DEST, -10_000)
    monkeypatch.setattr(routing, "drive_now", lambda o, d: 20.0)
    good = onboard.handle_gps(s, 780, p)

    def broken(o, d):
        raise routing.RoutingError("boom")

    monkeypatch.setattr(routing, "drive_now", broken)
    out = onboard.handle_gps(s, 783, east_of(p, 1000))
    assert out["stale"] and out["eta"] == good["eta"] and out["p_on_time"] == good["p_on_time"]
    # retried on the next fix after 30 s, and recovers
    monkeypatch.setattr(routing, "drive_now", lambda o, d: 18.0)
    assert not onboard.handle_gps(s, 783 + 0.6, east_of(p, 1100))["stale"]


def test_replay_of_synthetic_track_with_detour(monkeypatch):
    origin, dest = east_of(DEST, -12_000), DEST
    # straight road east at 30 km/h; drive_now = 2 min per km of straight-line distance
    points = [east_of(origin, k * 250) for k in range(49)]
    minutes = [k * 0.5 for k in range(49)]
    track = sim.build_track(points, minutes, 13 * 60)
    monkeypatch.setattr(routing, "drive_now", lambda o, d: routing.distance_m(o, d) / 500)
    live.TRIPS.clear()
    live.register(live.LiveTrip("r1", 14 * 60 + 30, 12 * 60 + 45, dest, 25.0, origin))
    out = sim.replay("r1", track, speed=1, sleep=lambda s: None)

    assert out[-1]["phase"] == "arrived"
    flags = [o["detour"] for o in out]
    periods = sum(1 for a, b in zip([False, *flags], flags, strict=False) if b and not a)
    assert periods == 1
    progress = [o["progress"] for o in out if o["phase"] == "onboard"]
    assert all(b >= a for a, b in itertools.pairwise(progress))
    assert any(o["stopped"] for o in out)
    rec = out[-1]["record"]
    assert rec["drive_at_pickup"] == pytest.approx(24.0, abs=0.1) and rec["ride_min"] > 24


def test_the_chance_shown_is_never_certain():
    # The model gets very sure late in a ride; what the rider sees never says 0% or 100%.
    assert onboard.round_p(0.979) == 0.95 and onboard.round_p(1.0) == 0.95
    assert onboard.round_p(0.00004) == 0.05 and onboard.round_p(0.0) == 0.05
    assert onboard.round_p(0.62) == 0.6
