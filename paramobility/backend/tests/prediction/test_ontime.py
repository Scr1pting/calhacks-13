import numpy as np
import pytest

from app.prediction import ontime, personal, prior, ride
from app.prediction.personal import Trip

HISTORY = (Trip(13 * 60, 18, -7), Trip(13 * 60, 25, -14))
KEYED = (Trip(13 * 60, 28, -7, "a"), Trip(13 * 60, 25, -14, "a"), Trip(9 * 60, 2, -3, "b"))


def test_no_history_is_prior():
    x = np.linspace(-4.9, 120, 200)
    for t in (5 * 60, 8 * 60 + 30, 13 * 60, 17 * 60 + 45, 23 * 60 + 59):
        np.testing.assert_allclose(personal.lateness(t).cdf(x), prior.prior(t).cdf(x), rtol=1e-12)


@pytest.mark.parametrize(
    ("appt", "ws", "drive", "history", "now", "key"),
    [
        (14 * 60, 13 * 60, 25, (), None, None),
        (14 * 60, 13 * 60, 25, HISTORY, None, None),
        (14 * 60, 13 * 60, 25, KEYED, None, "a"),
        (9 * 60, 7 * 60 + 30, 30, (), None, None),
        (18 * 60, 17 * 60, 15, (), 17 * 60 + 20, None),
        (14 * 60, 13 * 60, 25, KEYED, 13 * 60 + 40, "a"),
    ],
)
def test_integral_matches_monte_carlo(appt, ws, drive, history, now, key):
    p = ontime.p_on_time(appt, ws, drive, history, now=now, key=key)
    mc = np.mean(ontime.arrival_draws(ws, drive, history, now=now, n=200_000, key=key) <= appt)
    assert abs(p - mc) < 0.01


def test_monotone():
    appt = 14 * 60
    by_window = [ontime.p_on_time(appt, w, 25) for w in range(11 * 60, 13 * 60 + 30, 10)]
    assert np.all(np.diff(by_window) < 0)
    by_appt = [ontime.p_on_time(a, 13 * 60, 25) for a in range(13 * 60 + 30, 16 * 60, 10)]
    assert np.all(np.diff(by_appt) > 0)
    by_drive = [ontime.p_on_time(appt, 13 * 60, d) for d in (5, 10, 20, 30, 45)]
    assert np.all(np.diff(by_drive) < 0)


def test_still_waiting_far_in_the_tail():
    L = ontime.pickup_quantiles(13 * 60, now=13 * 60 + 180)
    assert L.size == 2000
    assert np.all(np.isfinite(L)) and np.all(L > 180)


@pytest.mark.parametrize(
    ("appt", "drive", "history"),
    [
        (14 * 60, 25, ()),
        (14 * 60, 25, HISTORY),
        (8 * 60 + 15, 20, ()),
        (17 * 60 + 10, 40, ()),
    ],
)
def test_latest_window_start(appt, drive, history):
    target = 0.95
    w = ontime.latest_window_start(appt, drive, history, target=target)
    assert w is not None and w % 5 == 0 and w >= prior.SERVICE_START
    assert ontime.p_on_time(appt, w, drive, history) >= target
    assert ontime.p_on_time(appt, w + 5, drive, history) < target


def test_latest_window_start_impossible():
    assert ontime.latest_window_start(14 * 60, 120, max_back=60) is None


def test_latest_window_start_not_before_service():
    # an early appointment with a long drive would need a window before 05:00
    assert ontime.latest_window_start(5 * 60 + 30, 60) is None
    w = ontime.latest_window_start(6 * 60 + 30, 20, target=0.5)
    assert w is None or w >= prior.SERVICE_START


def test_evaluate_window():
    ev = ontime.evaluate_window(14 * 60, 13 * 60, 25, HISTORY)
    q = ev["arrival_vs_appointment"]
    assert 0 < ev["p_very_early"] < ev["p_on_time"] < 1
    assert q[0.1] < q[0.5] < q[0.9]
    # the median arrival inverts the cdf
    assert ontime.arrival_cdf(14 * 60 + q[0.5], 13 * 60, 25, HISTORY)[0] == pytest.approx(
        0.5, abs=0.01
    )


@pytest.mark.parametrize("d", [1.0, 12.5, 25.0, 90.0])
def test_ride_calibrated_on_mean(d):
    assert ride.ride_time(d).mean() == pytest.approx(ride.OVERHEAD_MIN + ride.KAPPA * d, rel=1e-9)
