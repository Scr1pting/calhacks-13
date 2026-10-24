"""Calibrate schedule tightness so simulated on-time performance matches EBP's.

On-time performance rises monotonically with plan_factor (more generous planned
travel times), so a bisection on plan_factor is enough.
"""
from __future__ import annotations

from dataclasses import replace

from .config import SimConfig
from .pipeline import World, summarize


def calibrate(cfg: SimConfig, days=(0, 1, 2), lo=0.95, hi=1.3, iters=7, log=print):
    history, best = [], None
    for _ in range(iters):
        mid = (lo + hi) / 2
        trial = replace(cfg, plan_factor=round(mid, 4))
        w = World(trial)
        s = summarize([w.simulate_day(d, seed_offset=99) for d in days])
        history.append(dict(plan_factor=round(mid, 4), otp=round(s["otp"], 4), denial_rate=round(s["denial_rate"], 4)))
        log(f"  plan_factor={mid:.3f}  on-time={s['otp']:.3f}  denied={s['denial_rate']:.3f}")
        if best is None or abs(s["otp"] - cfg.target_otp) < abs(best[1]["otp"] - cfg.target_otp):
            best = (trial, s)
        lo, hi = (mid, hi) if s["otp"] < cfg.target_otp else (lo, mid)
    trial, s = best
    return trial, dict(target_otp=cfg.target_otp, chosen_plan_factor=trial.plan_factor,
                       calibration_days=list(days), achieved=s, history=history)
