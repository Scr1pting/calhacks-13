"""Calibrate the simulation to EBP's on-time table (on time / 1-20 / 21-59 / 60+ min past window).

Stage 1, fleet: the smallest n_vans whose capacity denials are at or below
target_denial_rate (ADA paratransit should turn almost no one away), or within 0.1
points of the lowest rate any fleet size reaches if the target is out of reach.

Stage 2, schedule and rescue: for each candidate rescue_availability (run in parallel),
plan_factor is bisected to hit the on-time target, then the candidate is checked over
14 days and scored on the 21-59 and 60+ shares. 60+ is about one pickup per simulated
day, which is why the check needs two weeks. rescue_threshold_min stays at its config
value (30 min fitted well in an earlier sweep).
"""
from __future__ import annotations

import math
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace

from .config import SimConfig
from .pipeline import World, summarize

AVAILABILITY = (1.0, 0.75, 0.5, 0.3, 0.15)
KEYS = ("otp", "late_1_20", "late_21_59", "late_60_plus", "rescue_rate", "denial_rate")


def _metrics(s):
    return {k: round(s[k], 5) for k in KEYS}


def _run(cfg, days):
    return summarize([World(cfg).simulate_day(d, seed_offset=99) for d in days])


def _denials(args):
    cfg, days = args
    return _run(cfg, days)["denial_rate"]


def _fit(args):
    cfg, days, check_days, lo, hi, iters = args
    best, history = None, []
    for _ in range(iters):
        mid = round((lo + hi) / 2, 4)
        trial = replace(cfg, plan_factor=mid)
        s = _run(trial, days)
        history.append(dict(plan_factor=mid, **_metrics(s)))
        if best is None or abs(s["otp"] - cfg.target_otp) < abs(best[1]["otp"] - cfg.target_otp):
            best = (trial, s)
        lo, hi = (mid, hi) if s["otp"] < cfg.target_otp else (lo, mid)
    return best[0], _run(best[0], check_days), history


def _score(cfg, s):
    rel = lambda sim, tgt: abs(math.log((sim + 1e-4) / (tgt + 1e-4)))
    return rel(s["late_21_59"], cfg.target_late_21_59) + rel(s["late_60_plus"], cfg.target_late_60_plus)


def calibrate(cfg: SimConfig, days=(0, 1, 2), check_days=tuple(range(14)), plan_factor_guess=1.16,
              lo=0.95, hi=1.6, iters=7, availability=AVAILABILITY, log=print):
    with ProcessPoolExecutor(5) as ex:
        fleet = list(range(cfg.n_vans, int(1.6 * cfg.n_vans) + 1, 20))
        probe = replace(cfg, plan_factor=plan_factor_guess)
        denials = list(ex.map(_denials, [(replace(probe, n_vans=n), days) for n in fleet]))
        for n, d in zip(fleet, denials):
            log(f"  fleet {n:3d} vans: denied {d:.2%}")
        # some early-morning dialysis trips can't be served by any fleet size; stop where more vans stop helping
        enough = max(cfg.target_denial_rate, min(denials) + 0.001)
        n_vans = next(n for n, d in zip(fleet, denials) if d <= enough)
        log(f"-> n_vans={n_vans}")
        base = replace(cfg, n_vans=n_vans)

        jobs = [(replace(base, rescue_availability=a), days, check_days, lo, hi, iters) for a in availability]
        results = []
        for a, (trial, check, history) in zip(availability, ex.map(_fit, jobs)):
            results.append((_score(cfg, check), trial, check, history))
            log(f"  backup available {a:4.0%}: plan_factor={trial.plan_factor:.3f}  on-time={check['otp']:.3f}  "
                f"1-20={check['late_1_20']:.2%}  21-59={check['late_21_59']:.2%}  60+={check['late_60_plus']:.3%}  "
                f"rescued={check['rescue_rate']:.2%}  denied={check['denial_rate']:.2%}")
    _, trial, check, _ = min(results, key=lambda r: r[0])
    targets = dict(otp=cfg.target_otp, late_1_20=cfg.target_late_1_20, late_21_59=cfg.target_late_21_59,
                   late_60_plus=cfg.target_late_60_plus, denial_rate=cfg.target_denial_rate)
    return trial, dict(targets=targets, chosen=dict(n_vans=trial.n_vans, plan_factor=trial.plan_factor,
                                                    rescue_availability=trial.rescue_availability,
                                                    rescue_threshold_min=trial.rescue_threshold_min),
                       fleet_probe=dict(zip(fleet, denials)), calibration_days=list(days),
                       check_days=list(check_days), achieved=check,
                       candidates=[dict(rescue_availability=r[1].rescue_availability, plan_factor=r[1].plan_factor,
                                        score=round(r[0], 3), **_metrics(r[2]), history=r[3]) for r in results])
