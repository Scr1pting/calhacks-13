"""Test the live lateness field (live.py) against the paratransit simulator (handoff §9).

The simulator (backend/paratransit-sim) has no buses and no injected jams, so this tests the van
output only. Its ground truth is lateness per trip, L = actual_pickup - promised, not a field per
cell, so the test forecasts held-out riders:

* forecast: riders whose window opens in the next 15 min, predicted from their cell and block;
* waiting: riders whose window opened less than 30 min ago and who are still waiting,
  P(on time | not picked up yet) = (F(30) - F(t0)) / (1 - F(t0)).

Weekdays of week 1 set the priors and tune hyperparameters; weekdays of week 2 are scored. 20% of
riders are held out as targets and never report. Each adoption level draws its reporting riders
from the rest. A `LiveField` steps through each test day every 15 minutes, as in deployment.

Metrics: Brier score of P(on time), Brier skill against the hour-of-day prior, two-sided 90%
interval coverage, and how often L exceeds the 95% quantile (5% if calibrated). The upper tail
matters most: it sets how early to book. 23% of simulated pickups have L = 0 exactly (an early van
waits for the window), so the lower bound almost always covers and two-sided coverage flatters.

    python eval_sim.py [--trips PATH] [--quick]
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import h3
import numpy as np
import pandas as pd
from scipy.special import ndtr, ndtri
from scipy.stats import rankdata

from live import C_SHIFT, H3_RES, MU_EB, LiveField, Params, RiderObs

SIM_TRIPS = Path(__file__).resolve().parents[1] / "backend/paratransit-sim/data/trips.csv"
TRAIN_DAYS, TEST_DAYS = (0, 1, 2, 3, 4), (7, 8, 9, 10, 11)
EVAL_TIMES = np.arange(6 * 60, 19 * 60 + 1, 15.0)
WINDOW = 30.0
HELD_OUT = 0.2
ADOPTION = (0.01, 0.05, 0.20, 1.0)
LATENT_GRID = (
    0.02,
    0.05,
    0.1,
    0.2,
    0.45,
)  # share of the prior variance in the GP; the rest is rider noise


def load(path: Path) -> pd.DataFrame:
    t = pd.read_csv(path)
    t = t[~t["denied"] & (t["pickup_status"] == "ok")].copy()
    t["L"] = t["actual_pickup"] - t["promised"]
    t["y"] = np.log(t["L"] + C_SHIFT)
    t["cell"] = [
        h3.latlng_to_cell(a, b, H3_RES) for a, b in zip(t["o_lat"], t["o_lon"], strict=True)
    ]
    rng = np.random.default_rng(0)
    riders = t["rider_id"].unique()
    t["held_out"] = t["rider_id"].isin(set(rng.choice(riders, int(HELD_OUT * len(riders)), False)))
    # One uniform draw per rider; a rider reports at adoption a when the draw is below a.
    draw = dict(zip(riders, rng.uniform(size=len(riders)), strict=True))
    t["draw"] = t["rider_id"].map(draw)
    return t


def hour_of_day_prior(train: pd.DataFrame):
    """mu0(t) from mean log lateness per hour on training days, and the residual SD."""
    hour = (train["promised"] // 60).astype(int)
    overall = float(train["y"].mean())
    stats = train.groupby(hour)["y"].agg(["mean", "size"])
    table = {int(h): float(r["mean"]) if r["size"] >= 50 else overall for h, r in stats.iterrows()}
    s = float((train["y"] - hour.map(table)).std())
    return (lambda minutes: table.get(int(minutes // 60), overall)), s


def latent_params(s: float, share: float) -> Params:
    # Keep the default 5:4 split between traffic and strain.
    return Params(s=s, frac_traffic=share * 5 / 9, frac_strain=share * 4 / 9)


def van_baseline_fit(days: list[pd.DataFrame], mu0):
    """Regress a target's log lateness on its van's last completed pickup (both vs mu0)."""
    x, y = [], []
    for day in days:
        for now in EVAL_TIMES:
            for kind in ("forecast", "waiting"):
                tg = targets(day, now, kind)
                prev = last_van_pickup(day, tg, now)
                ok = ~np.isnan(prev[:, 0])
                x += list(prev[ok, 0] - [mu0(t) for t in prev[ok, 1]])
                y += list(tg["y"].to_numpy()[ok] - [mu0(t) for t in tg["promised"].to_numpy()[ok]])
    x, y = np.array(x), np.array(y)
    b = float(x @ y / (x @ x))
    return b, float(np.std(y - b * x))


def last_van_pickup(day: pd.DataFrame, tg: pd.DataFrame, now: float) -> np.ndarray:
    """(y, promised) of the latest pickup on each target's van completed before `now`.

    Excludes the targets themselves: a forecast target picked up exactly at its window start
    would otherwise predict itself.
    """
    done = day[(day["actual_pickup"] < now) & ~day["trip_id"].isin(tg["trip_id"])]
    done = done.sort_values("actual_pickup")
    last = done.groupby("van_id").tail(1).set_index("van_id")
    out = np.full((len(tg), 2), np.nan)
    hit = tg["van_id"].isin(last.index).to_numpy()
    out[hit] = last.loc[tg["van_id"][hit], ["y", "promised"]].to_numpy()
    return out


def targets(day: pd.DataFrame, now: float, kind: str) -> pd.DataFrame:
    h = day[day["held_out"]]
    if kind == "forecast":
        return h[(h["promised"] >= now) & (h["promised"] < now + 15)]
    return h[(h["promised"] < now) & (h["actual_pickup"] > now) & (now - h["promised"] < WINDOW)]


def observations(day: pd.DataFrame, now: float, adoption: float, history: float):
    r = day[~day["held_out"] & (day["draw"] < adoption)]
    r = r[(r["promised"] < now) & (r["promised"] >= now - history)]
    return [
        RiderObs(tid, cell, ws, pick if pick <= now else None)
        for tid, cell, ws, pick in zip(
            r["trip_id"], r["cell"], r["promised"], r["actual_pickup"], strict=True
        )
    ]


def gp_predict(lf: LiveField, tg: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Rider-level predictive (mean, SD) in log space for each target."""
    m, s = np.empty(len(tg)), np.empty(len(tg))
    blocks = (tg["promised"] // 15).astype(int).to_numpy()
    cells = tg["cell"].to_numpy()
    for blk in np.unique(blocks):
        sel = blocks == blk
        uniq = sorted(set(cells[sel]))
        est = lf.predict(uniq, int(blk))
        pos = {c: i for i, c in enumerate(uniq)}
        idx = np.array([pos[c] for c in cells[sel]])
        m[sel], s[sel] = est.mean[idx], np.hypot(est.sd, est.noise_sd)[idx]
    return m, s


def score(m, s, L, waited) -> dict:
    """Metrics for Gaussian predictives N(m, s^2) of log(L + c), given L > waited."""
    F = lambda x: ndtr((np.log(x + C_SHIFT) - m) / s)  # noqa: E731
    F0 = np.where(waited > 0, F(waited), 0.0)
    p_on = np.clip((F(WINDOW) - F0) / (1 - F0), 0, 1)
    q = lambda u: np.exp(m + s * ndtri(np.clip(F0 + u * (1 - F0), 1e-12, 1 - 1e-12))) - C_SHIFT  # noqa: E731
    lo, hi = q(0.05), q(0.95)
    on = (L <= WINDOW).astype(float)
    late = on == 0
    # AUC: chance that a late rider gets a higher P(late) than an on-time one.
    ranks = rankdata(1 - p_on)
    auc = (ranks[late].sum() - late.sum() * (late.sum() + 1) / 2) / (late.sum() * (~late).sum())
    return dict(
        n=len(L),
        brier=float(np.mean((p_on - on) ** 2)),
        p_on=float(p_on.mean()),
        obs_on=float(on.mean()),
        cover90=float(np.mean((L >= lo) & (L <= hi))),
        above95=float(np.mean(L > hi)),
        mae=float(np.mean(np.abs(np.maximum(q(0.5), 0.0) - L))),
        auc=float(auc),
    )


def run_day(day, variant, adoption, mu0, params, van=None) -> dict[str, list]:
    kind_fit, method = variant
    lf = LiveField(params, mu0=mu0, method=method or "gibbs", seed=0)
    acc = {k: [] for k in ("forecast", "waiting")}
    for now in EVAL_TIMES:
        if kind_fit == "gp":
            lf.update(now, [], observations(day, now, adoption, params.history))
        for kind in acc:
            tg = targets(day, now, kind)
            if tg.empty:
                continue
            m, s = gp_predict(lf, tg)  # no fit: the prior
            if kind_fit == "van":
                b, s_res = van
                prev = last_van_pickup(day, tg, now)
                ok = ~np.isnan(prev[:, 0])
                dev = prev[ok, 0] - np.array([mu0(t) for t in prev[ok, 1]])
                m[ok] = m[ok] + b * dev
                s[ok] = s_res
            waited = np.maximum(now - tg["promised"].to_numpy(), 0.0) if kind == "waiting" else 0.0
            acc[kind].append((m, s, tg["L"].to_numpy(), np.broadcast_to(waited, len(tg))))
    return acc


def evaluate(days, variant, adoption, mu0, params, van=None) -> dict[str, dict]:
    parts = {"forecast": [], "waiting": []}
    for day in days:
        for kind, chunks in run_day(day, variant, adoption, mu0, params, van).items():
            parts[kind] += chunks
    return {
        kind: score(*(np.concatenate([c[i] for c in chunks]) for i in range(4)))
        for kind, chunks in parts.items()
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--trips", type=Path, default=SIM_TRIPS)
    ap.add_argument("--quick", action="store_true", help="two test days, fewer variants")
    args = ap.parse_args()
    t0 = time.time()

    trips = load(args.trips)
    trips = trips[trips["dow"] < 5]
    by_day = {d: g for d, g in trips.groupby("day")}
    train = [by_day[d] for d in TRAIN_DAYS]
    test_days = TEST_DAYS[:2] if args.quick else TEST_DAYS
    test = [by_day[d] for d in test_days]
    mu_hod, s_hod = hour_of_day_prior(pd.concat(train))
    tr = pd.concat(train)
    print(
        f"simulator: {len(trips)} served weekday pickups, on time {np.mean(tr['L'] <= WINDOW):.1%}"
        f" (train); EBP prior assumes 94.1%"
    )
    print(f"hour-of-day prior from train days: residual SD {s_hod:.3f} (EBP prior s = 0.601)")

    print("tuning the latent share on train days (Gibbs, 20% adoption):")
    best = None
    for share in LATENT_GRID:
        r = evaluate(train, ("gp", "gibbs"), 0.20, mu_hod, latent_params(s_hod, share))
        brier = (r["forecast"]["brier"] + r["waiting"]["brier"]) / 2
        print(f"   share {share:.2f}: mean Brier {brier:.4f}")
        if best is None or brier < best[1]:
            best = (share, brier)
    share = best[0]
    tuned = latent_params(s_hod, share)
    van = van_baseline_fit(train, mu_hod)
    print(f"   -> share {share}; van baseline slope {van[0]:.2f}, residual SD {van[1]:.3f}")

    # name: ((kind, method), mu0, params, uses adoption)
    variants = {
        "prior: EBP": (("prior", None), lambda t: MU_EB, Params(), False),
        "prior: hour of day": (("prior", None), mu_hod, latent_params(s_hod, share), False),
        "GP gibbs, EBP prior": (("gp", "gibbs"), lambda t: MU_EB, Params(), True),
        "GP gibbs, EBP mu, sim spread": (("gp", "gibbs"), lambda t: MU_EB, tuned, True),
        f"GP gibbs (share {share})": (("gp", "gibbs"), mu_hod, tuned, True),
        "GP gibbs (share 0.45)": (("gp", "gibbs"), mu_hod, latent_params(s_hod, 0.45), True),
        f"GP em (share {share})": (("gp", "em"), mu_hod, tuned, True),
        f"GP plugin (share {share})": (("gp", "plugin"), mu_hod, tuned, True),
        f"GP ignore (share {share})": (("gp", "ignore"), mu_hod, tuned, True),
        "van's last pickup *": (("van", None), mu_hod, tuned, False),
    }
    if args.quick:
        variants = {k: v for k, v in variants.items() if " em" not in k and "0.45" not in k}

    rows = []
    for name, (variant, mu0, params, adoptive) in variants.items():
        for adoption in ADOPTION if adoptive else (None,):
            r = evaluate(test, variant, adoption or 0.0, mu0, params, van)
            for kind, s in r.items():
                rows.append(dict(variant=name, adoption=adoption, target=kind, **s))
    res = pd.DataFrame(rows)
    ref = res[res["variant"] == "prior: hour of day"].set_index("target")["brier"]
    res["skill"] = 1 - res["brier"] / res["target"].map(ref)

    for kind in ("forecast", "waiting"):
        sub = res[res["target"] == kind]
        print(f"\n{kind} targets (n = {sub['n'].iloc[0]} per row, test days {list(test_days)})")
        print(
            f"{'variant':28} {'adopt':>6} {'Brier':>7} {'skill':>7} {'P(on)':>6} {'obs':>6}"
            f" {'cov90':>6} {'>q95':>6} {'MAE':>5} {'AUC':>5}"
        )
        for r in sub.itertuples():
            adopt = "-" if pd.isna(r.adoption) else f"{r.adoption:.0%}"
            print(
                f"{r.variant:28} {adopt:>6} {r.brier:7.4f} {r.skill:+7.1%} {r.p_on:6.1%}"
                f" {r.obs_on:6.1%} {r.cover90:6.1%} {r.above95:6.1%} {r.mae:5.1f} {r.auc:5.2f}"
            )
    print(
        "\n* van's last pickup uses every rider's pickup on the target's van (agency or shared-van"
        " data, §6.4), not just app users."
    )
    print(f"done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
