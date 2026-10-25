// Leeway's forecast for one ride in progress, using only what it could know at
// time t: how much of the route is left, the van's planned pace, and how the
// ride has gone so far. The slowdown so far is shrunk toward the plan (a
// prior worth PRIOR_MIN minutes of driving), so one slow block doesn't
// convince it the whole ride will crawl, but a long crawl does.
//
// Arrival = now + remaining minutes x a lognormal spread. Everything here is
// analytic (no random draws), so the drawing never jitters frame to frame.

const PRIOR_MIN = 40
const SIGMA = 0.16
const GHOSTS = 41

const km = (a, b) => Math.hypot((a[0] - b[0]) * 88, (a[1] - b[1]) * 111) // East Bay, close enough

// Inverse of the standard normal CDF (Acklam's approximation).
function probit(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924]
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857]
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878]
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]
  const q = p < 0.5 ? p : 1 - p
  let x
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q))
    x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
  } else {
    const r = q - 0.5
    const s = r * r
    x = ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) /
      (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
    return p < 0.5 ? x : -x
  }
  return p < 0.5 ? x : -x
}
// Standard normal CDF.
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const p = 1 - (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) * poly
  return z >= 0 ? p : 1 - p
}
const Z = Array.from({ length: GHOSTS }, (_, i) => probit((i + 0.5) / GHOSTS))

// The ride from the moment the van leaves the pickup to the drop-off, with
// distance along the route for every point the van drove through.
export function makeRide(fleet, tripId) {
  const pickup = fleet.stops.find((s) => s.trip === tripId && s.kind === 'P')
  const dropoff = fleet.stops.find((s) => s.trip === tripId && s.kind === 'D')
  const van = fleet.vansById[pickup.van]
  const idx = van.times.map((t, i) => i).filter((i) => van.times[i] >= pickup.t && van.times[i] <= dropoff.t)
  const route = []
  let along = 0
  idx.forEach((i, k) => {
    if (k) along += km(van.path[idx[k - 1]], van.path[i])
    route.push({ pos: van.path[i], km: along, t: van.times[i] })
  })
  // The van leaves when its position first changes after the pickup.
  const depart = route.find((p) => p.pos[0] !== route[0].pos[0] || p.pos[1] !== route[0].pos[1])?.t ?? pickup.t
  // The plan, from how far behind it ran: shifted by however early it was at pickup.
  const plannedDrop = dropoff.t - dropoff.behind + pickup.behind
  const total = along
  return { van, pickup, dropoff, route, total, depart, plannedDrop, pace: total / (plannedDrop - depart) }
}

// Kilometres driven by time t.
export function kmAt(ride, t) {
  const r = ride.route
  if (t <= r[0].t) return 0
  if (t >= r[r.length - 1].t) return ride.total
  let lo = 0
  let hi = r.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (r[mid].t <= t) lo = mid
    else hi = mid
  }
  const f = r[hi].t > r[lo].t ? (t - r[lo].t) / (r[hi].t - r[lo].t) : 1
  return r[lo].km + f * (r[hi].km - r[lo].km)
}

// The point `k` km along the route.
export function positionAtKm(ride, k) {
  const r = ride.route
  if (k <= 0) return r[0].pos
  if (k >= ride.total) return r[r.length - 1].pos
  let lo = 0
  let hi = r.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (r[mid].km <= k) lo = mid
    else hi = mid
  }
  const f = r[hi].km > r[lo].km ? (k - r[lo].km) / (r[hi].km - r[lo].km) : 0
  return [r[lo].pos[0] + f * (r[hi].pos[0] - r[lo].pos[0]), r[lo].pos[1] + f * (r[hi].pos[1] - r[lo].pos[1])]
}

// The forecast at time t: remaining minutes (median), arrival quantiles, the
// chance of arriving by `by`, and where each "ghost" van would be at `by`.
export function forecast(ride, t, by) {
  const done = kmAt(ride, t)
  const arrived = t >= ride.dropoff.t
  const left = ride.total - done
  const plannedSoFar = done / ride.pace
  const elapsed = Math.max(0, t - ride.depart)
  const slowdown = t > ride.depart ? (elapsed + PRIOR_MIN) / (plannedSoFar + PRIOR_MIN) : 1
  const start = Math.max(t, ride.depart)
  const median = arrived ? ride.dropoff.t - t : start - t + (left / ride.pace) * slowdown
  const sigma = arrived ? 0 : SIGMA
  const arrival = (z) => t + median * Math.exp(sigma * z)
  const pOnTime = arrived ? (ride.dropoff.t <= by ? 1 : 0) : by <= t ? 0 : phi(Math.log((by - t) / median) / sigma)
  const ghosts = Z.map((z) => {
    const a = arrival(z)
    const onTime = a <= by
    // Linear progress from here to the drop-off, stopped where the clock reaches `by`.
    const k = onTime ? ride.total : done + left * Math.max(0, Math.min(1, (by - start) / (a - start)))
    return { onTime, k, arrival: a }
  })
  return { t, done, left, median, sigma, arrival, pOnTime, ghosts, low: arrival(-1.2816), high: arrival(1.2816) }
}

// Probability density of arriving at minute x (for the chart).
export function density(f, x) {
  if (!f.sigma || x <= f.t) return 0
  const d = x - f.t
  const z = Math.log(d / f.median) / f.sigma
  return Math.exp((-z * z) / 2) / (d * f.sigma * Math.sqrt(2 * Math.PI))
}
