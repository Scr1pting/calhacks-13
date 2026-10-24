"""Live lateness field: a multi-output Tobit GP fitted by Gibbs sampling (handoff §6.3).

Every simulated minute, `LiveField.update` refits the field from two sources:

* bus slowdown, binned per H3 res-7 cell and 15-min block (mean log travel-time anomaly
  with noise noise_bus^2 / n). Never raw bus points.
* van riders, with lateness L = pickup - window_start in minutes. A rider already picked up
  gives y = log(L + c). A rider still waiting is right-censored at log(now - window_start + c).

Model, on points (output, cell, block) with output in {bus, van}:

    y = f_a(x, t) + noise_a
    Cov[f_a(x,t), f_a'(x',t')] = B1[a,a'] k_M32(space; 3 km)  k_M12(time; 30 min)   # traffic
                               + B2[a,a'] k_RBF(space; 15 km) k_RBF(time; 3 h)      # strain

Prior mean is mu0(t) for van and 0 for bus. Latent 1 (traffic) loads on both outputs with
correlation rho. Latent 2 (system strain) loads on van only.

Gibbs data augmentation, exact. Exact observations at the same point collapse into one
precision-weighted mean, which loses nothing under Gaussian noise. That is also what bins the
bus data. Only censored riders need augmenting. With f integrated out everywhere else, a sweep
alternates

    f_C | y         Gaussian on the q points that hold censored riders
    y_j | f_C       TruncNormal(f_p(j), sigma^2, lower=c_j)

The noise is fixed, so K + T is factored once per refit and a sweep costs O(q^2). Queries
average over the sweeps analytically (Rao-Blackwellized): the mean comes from the average
pseudo-data, and the variance adds the spread of the sweeps to the GP predictive variance. The
resulting Gaussian mixture is moment-matched to one Gaussian in log space.

Prior constants (§6.2), fitted to EBP's own data rather than the NYC thresholds. The broker's
report in the EBPAC packet of Nov 4, 2025 bins pickups against the 30-min window. Pooling
Jul-Sep 2024 and Jul-Sep 2025: 95.15% on time (L <= 30), 4.05% 1-20 min past (L <= 50: 99.2%),
0.8% 21-59 min past, and 0.045% 60+ min past (L >= 90). Those bands only describe the tail, so
the shift c is barely identified: exact fits run from c = -3.5 to 10.9 within the rounding of
the published figures. We fix c = 5 (about 5% of pickups at the window start) and fit
P(L <= x) = Phi((log(x + c) - mu) / s) by least squares in probit space: s = 0.601, which
reproduces all three bands to within 0.03 points. Every c in [2, 10] gives the same 90th and
95th rider quantiles to within half a minute. Keeping s and c, we recalibrate mu to 2.615 so
that P(L > 30) = 5.9%, matching FY24-25's 94.1% on time. Pickup times inside the window are
unobserved, so the body of the distribution is an assumption.
The prior variance s^2 splits across traffic, strain and rider noise, so the van marginal keeps
that calibration. Pass prior.py's mu0(t) once it exists.

Times are minutes since midnight. Pickup locations enter only as H3 cell IDs.
"""

from __future__ import annotations

import math
import time
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

import h3
import numpy as np
from scipy import linalg
from scipy.special import log_ndtr, ndtr, ndtri

BLOCK_MINUTES = 15
H3_RES = 7
OUTPUTS = ("bus", "van")
BUS, VAN = 0, 1
METHODS = ("gibbs", "em", "plugin", "ignore")  # §9 compares all four

# Shifted-lognormal prior for EBP pickup lateness, in y = log(L + C_SHIFT); see module doc.
C_SHIFT = 5.0
S_TOTAL = 0.601
MU_EB = 2.615

# Local equirectangular projection around downtown Oakland; fine from Richmond to Fremont.
_LAT0, _LNG0 = 37.80, -122.27
_KM_PER_DEG = 111.32


def block_of(minutes: float) -> int:
    return int(minutes // BLOCK_MINUTES)


def block_center(block: int) -> float:
    return (block + 0.5) * BLOCK_MINUTES


@dataclass(frozen=True)
class Params:
    """Hand-set hyperparameters (no paired data to fit them). Change rho for the demo slider."""

    c: float = C_SHIFT
    s: float = S_TOTAL  # prior SD of a van rider's y around mu0
    # Shares of s^2 in the van output; the remainder is per-rider noise.
    frac_traffic: float = 0.25
    frac_strain: float = 0.20
    sd_bus: float = 0.25  # traffic SD of the bus log travel-time anomaly
    noise_bus: float = 0.20  # noise SD of one bus traversal
    rho: float = 0.5  # bus-van correlation of the traffic latent; unknown, try 0.2-0.8
    ell_space_traffic: float = 3.0  # km
    ell_time_traffic: float = 30.0  # min
    ell_space_strain: float = 15.0
    ell_time_strain: float = 180.0
    history: float = 240.0  # minutes of observations kept in the fit
    sweeps: int = 300
    burn_in: int = 50
    em_iters: int = 20

    @property
    def noise_van(self) -> float:
        frac = 1.0 - self.frac_traffic - self.frac_strain
        if frac <= 0:
            raise ValueError("frac_traffic + frac_strain must stay below 1")
        return self.s * math.sqrt(frac)

    def coregionalization(self) -> tuple[np.ndarray, np.ndarray]:
        """B1 (traffic) and B2 (strain) over (bus, van).

        B1 is built from rho directly; it equals w w^T + diag(kappa) for some w, kappa >= 0.
        Strain adds variance to van only, so the overall bus-van correlation is lower than rho:
        rho * sqrt(frac_traffic / (frac_traffic + frac_strain)).
        """
        if not -1.0 <= self.rho <= 1.0:
            raise ValueError("rho must be in [-1, 1]")
        vb = self.sd_bus**2
        vv = self.frac_traffic * self.s**2
        cov = self.rho * math.sqrt(vb * vv)
        b1 = np.array([[vb, cov], [cov, vv]])
        b2 = np.array([[0.0, 0.0], [0.0, self.frac_strain * self.s**2]])
        return b1, b2


@dataclass(frozen=True)
class BusBin:
    cell: str
    block: int
    anomaly: float  # mean log(travel time / typical for the hour) over the bin's traversals
    n: int  # traversals averaged


@dataclass(frozen=True)
class RiderObs:
    rider_id: str  # keys the warm start; any per-trip ID works
    cell: str  # H3 res-7 pickup cell
    window_start: float
    picked_up_at: float | None = None


@dataclass(frozen=True)
class FitStats:
    method: str
    points: int
    bus_bins: int
    exact: int
    censored: int
    seconds: float


@dataclass
class Estimate:
    """Posterior of the field at some cells in one block, in log space."""

    output: str
    block: int
    cells: list[str]
    mean: np.ndarray  # posterior mean of f
    sd: np.ndarray  # posterior SD of f
    noise_sd: float  # SD of one observation around f: a rider, or one bus traversal
    c: float
    n_reports: np.ndarray  # van riders in the fit per cell; show area stats only when >= 3

    def _natural(self, f: np.ndarray) -> np.ndarray:
        # van: minutes late; bus: fractional slowdown (0.3 = 30% slower than typical)
        return np.exp(f) - (self.c if self.output == "van" else 1.0)

    def median(self) -> np.ndarray:
        """Median of the cell's typical lateness (van) or slowdown (bus)."""
        return self._natural(self.mean)

    def interval(self, level: float = 0.9) -> tuple[np.ndarray, np.ndarray]:
        z = ndtri(0.5 + level / 2)
        return self._natural(self.mean - z * self.sd), self._natural(self.mean + z * self.sd)

    def cdf(self, minutes: float | np.ndarray) -> np.ndarray:
        """P(L <= minutes) for the next rider picked up in each cell. Van only."""
        if self.output != "van":
            raise ValueError("cdf is defined for van lateness")
        x = np.asarray(minutes, dtype=float)
        z = (np.log(np.maximum(x + self.c, 1e-12)) - self.mean) / np.hypot(self.sd, self.noise_sd)
        return np.where(x < 0, 0.0, ndtr(z))

    def p_late(self, minutes: float = 30.0) -> np.ndarray:
        return 1.0 - self.cdf(minutes)


@dataclass
class _Fit:
    params: Params
    out: np.ndarray
    cells: list[str]
    blocks: np.ndarray
    chol: np.ndarray  # lower Cholesky factor of K + T
    alpha: np.ndarray  # (K + T)^-1 (mean pseudo-data - m0)
    minv_c: np.ndarray | None  # columns of (K + T)^-1 at the censored points
    cov_c: np.ndarray | None  # covariance of the censored points' pseudo-data across sweeps
    reports: Counter


class LiveField:
    """Lateness field over H3 cells x 15-min blocks, refit with `update` every minute."""

    def __init__(
        self,
        params: Params | None = None,
        mu0: Callable[[float], float] | None = None,
        method: str = "gibbs",
        seed: int | None = None,
    ):
        if method not in METHODS:
            raise ValueError(f"method must be one of {METHODS}")
        self.params = params or Params()
        self.mu0 = mu0 or (lambda minutes: MU_EB)
        self.method = method
        self.rng = np.random.default_rng(seed)
        self._xy: dict[str, tuple[float, float]] = {}
        self._warm: dict[str, float] = {}  # last Gibbs draw of y per waiting rider
        self._fit: _Fit | None = None

    def update(
        self, now: float, bus_bins: Iterable[BusBin], riders: Iterable[RiderObs]
    ) -> FitStats:
        """Refit on observations from the last `params.history` minutes."""
        start = time.perf_counter()
        p = self.params
        sigma2 = p.noise_van**2
        oldest, current = block_of(now - p.history), block_of(now)

        index: dict[tuple[int, str, int], int] = {}
        prec: list[float] = []  # precision of the exact observations at each point
        wsum: list[float] = []  # precision-weighted sum of those observations

        def point(key: tuple[int, str, int]) -> int:
            if key not in index:
                index[key] = len(prec)
                prec.append(0.0)
                wsum.append(0.0)
            return index[key]

        n_bus = 0
        for b in bus_bins:
            if oldest <= b.block <= current and b.n >= 1:
                i = point((BUS, b.cell, b.block))
                w = b.n / p.noise_bus**2
                prec[i] += w
                wsum[i] += w * b.anomaly
                n_bus += 1

        # A rider's point is the block of their window start, so it stays put at pickup.
        reports: Counter = Counter()
        cens_ids: list[str] = []
        cens_pt: list[int] = []
        cens_lo: list[float] = []
        n_exact = 0
        for r in riders:
            blk = block_of(r.window_start)
            if blk < oldest or r.window_start >= now:
                continue
            key = (VAN, r.cell, blk)
            if r.picked_up_at is not None and r.picked_up_at <= now:
                y = math.log(max(r.picked_up_at - r.window_start, 0.0) + p.c)
            elif self.method == "ignore":
                continue
            else:
                y = math.log(now - r.window_start + p.c)
                if self.method != "plugin":
                    cens_ids.append(r.rider_id)
                    cens_pt.append(point(key))
                    cens_lo.append(y)
                    reports[r.cell] += 1
                    continue
            i = point(key)
            prec[i] += 1.0 / sigma2
            wsum[i] += y / sigma2
            reports[r.cell] += 1
            n_exact += 1

        keys = list(index)
        if not keys:
            self._fit = None
            return FitStats(self.method, 0, 0, 0, 0, time.perf_counter() - start)
        out = np.array([k[0] for k in keys])
        cells = [k[1] for k in keys]
        blocks = np.array([k[2] for k in keys])
        b1, b2 = p.coregionalization()
        K = self._kernel(b1, b2, out, cells, blocks, out, cells, blocks)
        m0 = self._prior_mean(out, blocks)
        prec0, wsum0 = np.array(prec), np.array(wsum)
        pts, lo = np.array(cens_pt, dtype=int), np.array(cens_lo)

        minv_c = cov_c = None
        if self.method == "gibbs" and len(pts):
            chol, alpha, minv_c, cov_c, y = self._gibbs(K, m0, prec0, wsum0, pts, lo, cens_ids)
            self._warm = dict(zip(cens_ids, y.tolist(), strict=True))
        elif self.method == "em" and len(pts):
            chol, alpha = self._em(K, m0, prec0, wsum0, pts, lo)
        else:
            chol = _cholesky(K + np.diag(1.0 / prec0))
            alpha = linalg.cho_solve((chol, True), wsum0 / prec0 - m0)

        self._fit = _Fit(p, out, cells, blocks, chol, alpha, minv_c, cov_c, reports)
        return FitStats(
            self.method, len(keys), n_bus, n_exact, len(pts), time.perf_counter() - start
        )

    def predict(self, cells: Sequence[str], block: int, output: str = "van") -> Estimate:
        """Posterior at `cells` in `block` (past, current or future)."""
        a = OUTPUTS.index(output)
        cells = list(cells)
        n = len(cells)
        fit = self._fit
        p = fit.params if fit else self.params
        b1, b2 = p.coregionalization()
        out_q, blocks_q = np.full(n, a), np.full(n, block)
        mean = self._prior_mean(out_q, blocks_q)
        var = np.full(n, b1[a, a] + b2[a, a])
        if fit is not None:
            Ks = self._kernel(b1, b2, out_q, cells, blocks_q, fit.out, fit.cells, fit.blocks)
            mean = mean + Ks @ fit.alpha
            V = linalg.solve_triangular(fit.chol, Ks.T, lower=True, check_finite=False)
            var = var - np.einsum("ij,ij->j", V, V)
            if fit.minv_c is not None:
                G = Ks @ fit.minv_c
                var = var + np.einsum("ij,jk,ik->i", G, fit.cov_c, G)
        reports = fit.reports if fit else Counter()
        return Estimate(
            output=output,
            block=block,
            cells=cells,
            mean=mean,
            sd=np.sqrt(np.maximum(var, 1e-12)),
            noise_sd=p.noise_van if a == VAN else p.noise_bus,
            c=p.c,
            n_reports=np.array([reports.get(c, 0) for c in cells]),
        )

    def _gibbs(self, K, m0, prec0, wsum0, pts, lo, ids):
        """Blocked Gibbs over the censored riders; returns the fit and the last draws of y."""
        p, rng = self.params, self.rng
        sigma = p.noise_van
        m = len(m0)
        # Censored riders add fixed precision, so K + T is factored once for the whole chain.
        prec = prec0 + np.bincount(pts, minlength=m) / sigma**2
        chol = _cholesky(K + np.diag(1.0 / prec))
        cpts, rider_c = np.unique(pts, return_inverse=True)
        q = len(cpts)

        # f_C | pseudo-data: mean = base + W_cc d, where d holds the censored riders' share of
        # the pseudo-data at C; the covariance doesn't depend on y.
        minv_c = linalg.cho_solve((chol, True), np.eye(m)[:, cpts])
        W_c = minv_c.T @ K  # K[C,:] (K + T)^-1
        chol_c = _cholesky(K[np.ix_(cpts, cpts)] - W_c @ K[:, cpts])
        ybar0 = wsum0 / prec
        base = m0[cpts] + W_c @ (ybar0 - m0)
        W_cc = W_c[:, cpts]
        to_d = 1.0 / (sigma**2 * prec[cpts])

        y = _truncnorm_lower(m0[pts], sigma, lo, rng)
        for j, rid in enumerate(ids):
            prev = self._warm.get(rid)
            if prev is not None and prev >= lo[j]:  # still above the rising bound
                y[j] = prev
        draws = np.empty((max(p.sweeps - p.burn_in, 1), q))
        for s in range(p.sweeps):
            d = to_d * np.bincount(rider_c, weights=y, minlength=q)
            f_c = base + W_cc @ d + chol_c @ rng.standard_normal(q)
            y = _truncnorm_lower(f_c[rider_c], sigma, lo, rng)
            if s >= p.sweeps - len(draws):
                draws[s - (p.sweeps - len(draws))] = to_d * np.bincount(
                    rider_c, weights=y, minlength=q
                )

        ybar = ybar0.copy()
        ybar[cpts] += draws.mean(axis=0)
        alpha = linalg.cho_solve((chol, True), ybar - m0)
        cov_c = np.atleast_2d(np.cov(draws, rowvar=False)) if len(draws) > 1 else np.zeros((q, q))
        return chol, alpha, minv_c, cov_c, y

    def _em(self, K, m0, prec0, wsum0, pts, lo):
        """Fallback: replace each censored y by E[y | y > c_j] and inflate its noise."""
        p = self.params
        sigma2 = p.noise_van**2
        m = len(m0)
        cpts, rider_c = np.unique(pts, return_inverse=True)
        y_imp, r = lo + p.noise_van, np.full(len(pts), sigma2)
        for _ in range(p.em_iters):
            prec = prec0 + np.bincount(pts, weights=1.0 / r, minlength=m)
            wsum = wsum0 + np.bincount(pts, weights=y_imp / r, minlength=m)
            chol = _cholesky(K + np.diag(1.0 / prec))
            alpha = linalg.cho_solve((chol, True), wsum / prec - m0)
            V = linalg.solve_triangular(chol, K[:, cpts], lower=True, check_finite=False)
            mean_c = m0[cpts] + K[cpts] @ alpha
            var_c = np.maximum(np.diag(K)[cpts] - np.einsum("ij,ij->j", V, V), 0.0)
            # Predictive of y_j given the data so far, truncated at its bound.
            mu, s = mean_c[rider_c], np.sqrt(sigma2 + var_c[rider_c])
            a = (lo - mu) / s
            lam = np.exp(-0.5 * a**2 - 0.5 * math.log(2 * math.pi) - log_ndtr(-a))
            y_new = mu + s * lam
            r = sigma2 + s**2 * np.maximum(1.0 + a * lam - lam**2, 0.0)
            done = np.max(np.abs(y_new - y_imp)) < 1e-3
            y_imp = y_new
            if done:
                break
        prec = prec0 + np.bincount(pts, weights=1.0 / r, minlength=m)
        wsum = wsum0 + np.bincount(pts, weights=y_imp / r, minlength=m)
        chol = _cholesky(K + np.diag(1.0 / prec))
        return chol, linalg.cho_solve((chol, True), wsum / prec - m0)

    def _prior_mean(self, out: np.ndarray, blocks: np.ndarray) -> np.ndarray:
        mu = {b: self.mu0(block_center(b)) for b in np.unique(blocks[out == VAN]).tolist()}
        return np.array(
            [mu[b] if o == VAN else 0.0 for o, b in zip(out.tolist(), blocks.tolist(), strict=True)]
        )

    def _kernel(self, b1, b2, out_a, cells_a, blocks_a, out_b, cells_b, blocks_b) -> np.ndarray:
        p = self.params
        uniq = list(dict.fromkeys([*cells_a, *cells_b]))
        pos = {c: i for i, c in enumerate(uniq)}
        xy = np.array([self._project(c) for c in uniq])
        dist = np.sqrt(((xy[:, None, :] - xy[None, :, :]) ** 2).sum(axis=-1))
        ia = np.array([pos[c] for c in cells_a])
        ib = np.array([pos[c] for c in cells_b])
        r1 = math.sqrt(3) * dist / p.ell_space_traffic
        space1 = ((1 + r1) * np.exp(-r1))[np.ix_(ia, ib)]
        space2 = np.exp(-0.5 * (dist / p.ell_space_strain) ** 2)[np.ix_(ia, ib)]
        dt = np.abs(np.subtract.outer(blocks_a, blocks_b)) * float(BLOCK_MINUTES)
        time1 = np.exp(-dt / p.ell_time_traffic)
        time2 = np.exp(-0.5 * (dt / p.ell_time_strain) ** 2)
        oa, ob = out_a[:, None], out_b[None, :]
        return b1[oa, ob] * space1 * time1 + b2[oa, ob] * space2 * time2

    def _project(self, cell: str) -> tuple[float, float]:
        if cell not in self._xy:
            lat, lng = h3.cell_to_latlng(cell)
            self._xy[cell] = (
                (lng - _LNG0) * _KM_PER_DEG * math.cos(math.radians(_LAT0)),
                (lat - _LAT0) * _KM_PER_DEG,
            )
        return self._xy[cell]


def _cholesky(A: np.ndarray) -> np.ndarray:
    jitter = 1e-9 * max(float(np.mean(np.diag(A))), 1e-12)
    for _ in range(6):
        try:
            return linalg.cholesky(A + jitter * np.eye(len(A)), lower=True, check_finite=False)
        except linalg.LinAlgError:
            jitter *= 100
    raise linalg.LinAlgError("matrix is not positive definite")


def _truncnorm_lower(mean, sd, lower, rng) -> np.ndarray:
    """Draw from N(mean, sd^2) truncated to [lower, inf), stable deep in the tail."""
    a = (np.asarray(lower) - mean) / sd
    u = 1.0 - rng.uniform(size=a.shape)  # in (0, 1]
    z = -ndtri(u * ndtr(-a))
    # Past a = 30 the tail mass underflows; the exponential tail approximation is then exact
    # to well below float precision.
    far = a > 30
    if far.any():
        z = np.where(far, a + rng.exponential(size=a.shape) / np.maximum(a, 1.0), z)
    return mean + sd * np.maximum(z, a)


# --- Self-check against the acceptance criteria (§11) ---------------------------------------
# The truth is a hand-written field, not GP draws (§6.1): rush-hour bumps, a corridor pattern,
# a growing system backlog, and an Oakland jam from 13:00 to 14:00.


def _demo_world(seed: int):
    rng = np.random.default_rng(seed)
    lats, lngs = np.linspace(37.52, 37.95, 50), np.linspace(-122.35, -121.95, 45)
    cells = sorted({h3.latlng_to_cell(la, ln, H3_RES) for la in lats for ln in lngs})
    proj = LiveField()._project
    xy = np.array([proj(c) for c in cells])
    jam_xy = np.array(proj(h3.latlng_to_cell(37.805, -122.27, H3_RES)))
    jam_dist = np.linalg.norm(xy - jam_xy, axis=1)

    def traffic(idx, t):
        rush = 0.2 * (np.exp(-0.5 * ((t - 480) / 60) ** 2) + np.exp(-0.5 * ((t - 1050) / 70) ** 2))
        corridor = 1 + 0.5 * np.sin(xy[idx, 0] / 6) * np.cos(xy[idx, 1] / 8)
        ramp = np.clip((t - 780) / 15, 0, 1) * (t < 840)
        return rush * corridor + 0.9 * np.exp(-0.5 * (jam_dist[idx] / 3) ** 2) * ramp

    def van(idx, t):
        return MU_EB - 0.1 + 1.0 * traffic(idx, t) + 0.15 * np.clip((t - 600) / 300, 0, 1)

    bus_cells = rng.choice(len(cells), size=115, replace=False)
    bus = []
    for blk in range(block_of(360), block_of(1080) + 1):
        n = 1 + rng.poisson(3, size=len(bus_cells))
        f = traffic(bus_cells, block_center(blk))
        anomaly = f + rng.normal(0, 0.2, size=len(bus_cells)) / np.sqrt(n)
        bus += [
            BusBin(cells[i], blk, float(v), int(k))
            for i, v, k in zip(bus_cells, anomaly, n, strict=True)
        ]

    noise = Params().noise_van
    riders = []
    for j in range(220):
        i, ws = int(rng.integers(len(cells))), float(rng.uniform(360, 1080))
        late = max(math.exp(van(i, ws) + rng.normal(0, noise)) - C_SHIFT, 0.0)
        riders.append((RiderObs(f"r{j}", cells[i], ws), ws + late))
    return cells, jam_dist, traffic, van, bus, riders


def _observe(bus, riders, now):
    bins = [b for b in bus if b.block <= block_of(now)]
    obs = [
        RiderObs(r.rider_id, r.cell, r.window_start, pick if pick <= now else None)
        for r, pick in riders
    ]
    return bins, obs


def _selfcheck() -> None:
    print("1. refit + predict time, 300 sweeps (target < 1 s)")
    cells, jam_dist, traffic, van, bus, riders = _demo_world(seed=0)
    bins, obs = _observe(bus, riders, 810.0)
    lf = LiveField(seed=0)
    times = []
    for minute in range(6):  # minute-by-minute loop with warm starts
        t0 = time.perf_counter()
        stats = lf.update(805.0 + minute, bins, obs)
        lf.predict(cells, block_of(805.0 + minute), "van")
        lf.predict(cells, block_of(805.0 + minute), "bus")
        times.append(time.perf_counter() - t0)
    print(
        f"   {stats.points} points ({stats.bus_bins} bus bins, {stats.exact} picked up, "
        f"{stats.censored} waiting), {len(cells)} cells x 2 layers"
    )
    print(f"   median {np.median(times[1:]):.3f} s, max {max(times[1:]):.3f} s")

    print("2. Gibbs vs quadrature: one cell, 5 riders waiting about an hour (log space)")
    cell, now = cells[0], 840.0
    waiting = [RiderObs(f"w{j}", cell, 780.0 + j) for j in range(5)]
    k = sum(b[VAN, VAN] for b in Params().coregionalization())
    sigma = Params().noise_van
    f = np.linspace(MU_EB - 8, MU_EB + 8, 20001)
    logw = -0.5 * (f - MU_EB) ** 2 / k
    for r in waiting:
        logw = logw + log_ndtr((f - math.log(now - r.window_start + C_SHIFT)) / sigma)
    w = np.exp(logw - logw.max())
    w /= w.sum()
    print(f"   quadrature  mean {w @ f:.3f}  sd {math.sqrt(w @ (f - w @ f) ** 2):.3f}")
    for method in METHODS:
        lf = LiveField(Params(sweeps=5000), method=method, seed=0)
        lf.update(now, [], waiting)
        e = lf.predict([cell], block_of(780.0))
        print(f"   {method:10}  mean {e.mean[0]:.3f}  sd {e.sd[0]:.3f}")

    print("3. jam on the map before any rider is picked up late (jam 13:00-14:00)")
    jam, ring = jam_dist < 2.5, (jam_dist > 8) & (jam_dist < 15)
    now = 795.0
    bins, obs = _observe(bus, riders, now)
    late = sum(
        pick - o.window_start > 30 and jam_dist[cells.index(o.cell)] < 5
        for o, (_, pick) in zip(obs, riders, strict=True)
        if o.picked_up_at is not None
    )
    print(f"   riders picked up >30 min late near the jam so far: {late}")
    for label, use_bus in (("with buses", True), ("vans only", False)):
        lf = LiveField(seed=0)
        lf.update(now, bins if use_bus else [], obs)
        e = lf.predict(cells, block_of(now))
        pl = e.p_late(30)
        print(
            f"   {label:10}: P(>30 min late) jam {pl[jam].mean():.3f} vs ring {pl[ring].mean():.3f}"
            f"  (median {e.median()[jam].mean():.1f} vs {e.median()[ring].mean():.1f} min)"
        )

    print("4. 90% interval coverage of the true van field (target 85-95%)")
    for rho in (0.2, 0.5, 0.8):
        hits, in_jam = [], []
        for seed in range(3):
            cells, jam_dist, traffic, van, bus, riders = _demo_world(seed)
            for now in (600.0, 810.0, 1000.0):
                bins, obs = _observe(bus, riders, now)
                lf = LiveField(Params(rho=rho), seed=seed)
                lf.update(now, bins, obs)
                for blk in (block_of(now) - 2, block_of(now)):
                    e = lf.predict(cells, blk)
                    z = (van(np.arange(len(cells)), block_center(blk)) - e.mean) / e.sd
                    hits.append(np.abs(z) <= ndtri(0.95))
                    in_jam.append((jam_dist < 2.5) & (780 <= block_center(blk) < 840))
        hits, in_jam = np.concatenate(hits), np.concatenate(in_jam)
        print(
            f"   rho {rho:.1f}: all {hits.mean():.1%}, jam {hits[in_jam].mean():.1%}, "
            f"elsewhere {hits[~in_jam].mean():.1%}"
        )


if __name__ == "__main__":
    _selfcheck()
