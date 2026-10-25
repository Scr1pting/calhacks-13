"""Live arrival estimate while the rider is in the van, from GPS fixes and live drive times.

Before pickup the estimate is ontime's (pickup + ride). After pickup only the rest of the ride is
uncertain. With drive_now the live traffic-aware drive time from the van to the destination and
drive_at_pickup the same at the first poll after pickup:

    f          = min(prev_f, drive_now / drive_at_pickup)  # share of the ride left, never grows
    kappa_rem  = 1 + (KAPPA - 1) * f                       # fewer detours left as the ride goes on
    s_rem      = S_RIDE * sqrt(max(f, 0.05))               # and less spread
    mean_rem   = kappa_rem * drive_now + OVERHEAD_MIN * f  # calibrated on the mean, like ride_time
    R_rem      ~ lognorm(s_rem, scale=mean_rem * exp(-s_rem^2 / 2))

Flags (display only, the model ignores them):
* detour: drive_now is >= DETOUR_MIN above the best remaining drive so far
  (prev_f * drive_at_pickup) after moving >= DETOUR_MOVE_M since the last poll. f stays put, so
  a detour isn't read as "detours are over". The flag holds until drive_now is back under that
  bar. (Comparing with the best so far rather than only the previous poll also catches detours
  that grow ~1 min per poll.)
* stopped: no movement beyond STALL_M for STALL_MIN while f > 0.1 (likely picking someone up).

Display is kept calm: the ETA is an EMA (alpha 0.5) of the model median and only moves in steps of
>= 2 min, probabilities are rounded to 5%, and the running-late alert fires once per crossing.

Known gaps:
* kappa_rem (linear in the remaining share) is an assumption; per-trip ride histories could show
  how much detour typically remains at each progress level.
* Google can lag behind a fresh jam; the speed observed between fixes could be blended in.
* Background location on the web stops when the page closes; production needs a native app or
  the phone-call flow.

Times are minutes since midnight; positions are (lat, lng).
"""

from dataclasses import dataclass, field

import numpy as np
from scipy import stats

from . import routing
from .ride import KAPPA, OVERHEAD_MIN, S_RIDE

LatLng = tuple[float, float]

MIN_GAP_S = 30.0  # never more than one routing call per 30 s per trip (attempts count)
MAX_GAP_S = 120.0  # poll at least every 2 min
MOVE_POLL_M = 300.0  # or after moving this far since the last call
# NOTE: at city speeds MOVE_POLL_M triggers about every MIN_GAP_S, ~90 calls per 45-min ride,
# rather than the ~20-25 the hand-off expected. Raise MOVE_POLL_M to cut cost.
DETOUR_MIN = 2.0
DETOUR_MOVE_M = 200.0
STALL_M = 50.0
STALL_MIN = 4.0
MIN_MEAN = 0.05  # minutes: floor for the remaining ride's mean (at the door, drive_now ~ 0)
ALPHA = 0.5  # EMA weight of the newest model ETA
ETA_STEP = 2.0  # only move the displayed ETA by at least this many minutes
P_STEP = 0.05  # displayed probabilities are rounded to this, and kept off 0 and 1
ALERT_BELOW, REARM_ABOVE = 0.7, 0.8  # P(on time) hysteresis for the running-late alert
ALERT_LATE_MIN = 5.0  # ... or the smoothed ETA passes appointment + this


@dataclass
class OnboardState:
    trip_id: str
    appointment: float  # minutes since midnight
    destination: LatLng
    drive_at_pickup: float | None = None
    prev_f: float = 1.0
    last_call_t: float | None = None  # last successful routing call, minutes since midnight
    last_call_pos: LatLng | None = None
    last_drive: float | None = None
    last_move_t: float | None = None
    last_pos: LatLng | None = None
    eta_smoothed: float | None = None
    alert_armed: bool = True
    # beyond the hand-off's fields
    last_attempt_t: float | None = None  # last routing attempt, successful or not
    move_anchor: LatLng | None = None  # where the van last moved > STALL_M from
    eta_displayed: float | None = None
    model: dict | None = None  # latest onboard_status
    detour: bool = False
    stopped: bool = False
    stale: bool = False
    alert: dict | None = None
    fallback: dict = field(default_factory=dict)  # estimate before the first poll (see handle_gps)
    alert_below: float = ALERT_BELOW  # P(on time) that fires the alert, for this trip
    alert_late_min: float = ALERT_LATE_MIN  # ... or minutes late that do


def should_poll(state: OnboardState, now: float, pos: LatLng, refresh: bool = False) -> bool:
    """Whether this fix warrants a routing call (first fix, stale, 2 min, 300 m, or a refresh)."""
    if state.last_attempt_t is not None and (now - state.last_attempt_t) * 60 < MIN_GAP_S:
        return False
    if state.last_call_t is None or state.stale or refresh:
        return True
    return (now - state.last_call_t) * 60 >= MAX_GAP_S or routing.distance_m(
        pos, state.last_call_pos
    ) >= MOVE_POLL_M


def remaining_ride(drive_now: float, f: float):
    """Frozen lognorm of the remaining ride minutes with share f of the ride left."""
    kappa_rem = 1 + (KAPPA - 1) * f
    s_rem = S_RIDE * np.sqrt(max(f, 0.05))
    mean_rem = max(kappa_rem * drive_now + OVERHEAD_MIN * f, MIN_MEAN)
    return stats.lognorm(s_rem, scale=mean_rem * np.exp(-(s_rem**2) / 2))


def onboard_status(
    state: OnboardState, now: float, drive_now: float, pos: LatLng | None = None
) -> dict:
    """The §1 model for a fresh drive_now taken at pos (default state.last_pos).

    Updates drive_at_pickup (first poll), prev_f, the detour flag and the last-call fields.
    """
    pos = state.last_pos if pos is None else pos
    if state.drive_at_pickup is None:
        state.drive_at_pickup = drive_now
    best = state.prev_f * state.drive_at_pickup  # best remaining drive seen so far
    moved = (
        pos is not None
        and state.last_call_pos is not None
        and routing.distance_m(pos, state.last_call_pos) >= DETOUR_MOVE_M
    )
    if drive_now >= best + DETOUR_MIN:
        state.detour = state.detour or moved
    else:
        state.detour = False
    f = min(state.prev_f, drive_now / state.drive_at_pickup) if state.drive_at_pickup > 0 else 0.0
    state.prev_f = f = max(f, 0.0)
    state.last_call_t, state.last_call_pos, state.last_drive = now, pos, drive_now

    R = remaining_ride(drive_now, f)
    p = float(R.cdf(state.appointment - now))
    state.model = {
        "t": now,
        "f": f,
        "drive_now": drive_now,
        "mean": float(R.mean()),
        "eta": now + float(R.median()),
        "eta_lo": now + float(R.ppf(0.1)),
        "eta_hi": now + float(R.ppf(0.9)),
        "p_on_time": p,
        "detour": state.detour,
    }
    return state.model


def track_movement(state: OnboardState, now: float, pos: LatLng) -> None:
    """Update last_pos and the stall clock; set state.stopped."""
    state.last_pos = pos
    if state.move_anchor is None or routing.distance_m(pos, state.move_anchor) > STALL_M:
        state.move_anchor, state.last_move_t = pos, now
    state.stopped = now - state.last_move_t >= STALL_MIN and state.prev_f > 0.1


def handle_gps(state: OnboardState, now: float, pos: LatLng, refresh: bool = False) -> dict:
    """One GPS fix (or a refresh request): poll routing if due, then smooth and maybe alert.

    Routing errors never reach the caller: the last estimate stays and the payload says stale.
    """
    track_movement(state, now, pos)
    if should_poll(state, now, pos, refresh):
        state.last_attempt_t = now
        try:
            drive = routing.drive_now(pos, state.destination)
        except routing.RoutingError:
            state.stale = True
        else:
            state.stale = False
            update_display(state, onboard_status(state, now, drive, pos))
    return payload(state)


def update_display(state: OnboardState, model: dict) -> None:
    """Smooth the ETA, step the displayed ETA, and fire or re-arm the running-late alert."""
    state.eta_smoothed = (
        model["eta"]
        if state.eta_smoothed is None
        else ALPHA * model["eta"] + (1 - ALPHA) * state.eta_smoothed
    )
    if state.eta_displayed is None or abs(state.eta_smoothed - state.eta_displayed) >= ETA_STEP:
        state.eta_displayed = state.eta_smoothed

    late = state.eta_smoothed - state.appointment
    if state.alert_armed and (
        model["p_on_time"] < state.alert_below or late > state.alert_late_min
    ):
        state.alert_armed = False
        minutes = max(5, round(late / 5) * 5)
        state.alert = {
            "type": "running_late",
            "minutes": minutes,
            "message": f"Tell the clinic you'll be about {minutes} min late?",
        }
    elif not state.alert_armed and model["p_on_time"] > REARM_ABOVE and late <= 0:
        state.alert_armed, state.alert = True, None


def payload(state: OnboardState) -> dict:
    """The live card's status.

    Before the first poll, falls back to state.fallback (pickup + full ride).
    """
    m = state.model or state.fallback
    if not m:
        raise ValueError("no estimate yet: poll first or set state.fallback")
    eta = state.eta_displayed if state.model else m["eta"]
    shift = eta - m["eta"]  # keep the range around the displayed ETA
    return {
        "phase": "onboard",
        "eta": hhmm(eta),
        "eta_range": [hhmm(m["eta_lo"] + shift), hhmm(m["eta_hi"] + shift)],
        "p_on_time": round_p(m["p_on_time"]),
        "minutes_late_expected": max(0, round(eta - state.appointment)),
        "detour": state.detour,
        "stopped": state.stopped,
        "stale": state.stale,
        "progress": round(1 - state.prev_f, 3),
        "alert": state.alert,
    }


def round_p(p: float) -> float:
    """The chance as the rider sees it: in P_STEP steps, from P_STEP to 1 - P_STEP.

    A ride that hasn't happened yet is never certain either way: the model's tails get very thin
    late in a ride (its spread shrinks with the share left), but routing and GPS can still be
    wrong. Only an arrival is certain (live.status says 1 or 0 then).
    """
    p = round(min(max(float(np.nan_to_num(p)), 0.0), 1.0) / P_STEP) * P_STEP
    return round(min(max(p, P_STEP), 1 - P_STEP), 2)


def hhmm(minutes: float) -> str:
    m = round(float(minutes)) % 1440
    return f"{m // 60:02d}:{m % 60:02d}"
