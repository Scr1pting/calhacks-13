// The simulated day: van trajectories and stop events (public/data/fleet.json,
// built by scripts/build_fleet.py), and fast lookups for any moment in it.
// Times are minutes after midnight.

export const CAUSE_LABELS = {
  inherited: 'Already behind',
  late_start_min: 'Late start',
  incident_min: 'Traffic incident',
  hard_address_min: 'Hard to find',
  rider_not_ready_min: 'Rider not ready',
  breakdown_min: 'Breakdown',
}

// Behind-plan bands, in minutes: on plan, slipping, late. Leeway's green
// (--lw-map-pin), with an amber and a red in the same muted register.
export const BANDS = [
  { max: 5, color: [47, 163, 107], label: 'On plan' },
  { max: 15, color: [217, 154, 30], label: '5–15 min behind' },
  { max: Infinity, color: [200, 72, 60], label: '15+ min behind' },
]
export const bandColor = (behind) => BANDS.find((b) => behind < b.max).color

export function clock(t) {
  const m = Math.round(t)
  const h = Math.floor(m / 60) % 24
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export const clock24 = (t) => {
  const m = Math.round(t)
  return `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`
}

// Last index i with arr[i] <= x (or -1).
function floorIndex(arr, x, key = (v) => v) {
  let lo = 0
  let hi = arr.length - 1
  if (hi < 0 || key(arr[0]) > x) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (key(arr[mid]) <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

function bearing(a, b) {
  const toRad = Math.PI / 180
  const y = Math.sin((b[0] - a[0]) * toRad) * Math.cos(b[1] * toRad)
  const x =
    Math.cos(a[1] * toRad) * Math.sin(b[1] * toRad) -
    Math.sin(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.cos((b[0] - a[0]) * toRad)
  return (Math.atan2(y, x) / toRad + 360) % 360
}

export async function loadFleet(url = '/data/fleet.json') {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status}). Run "npm run data" first.`)
  const data = await res.json()
  const stops = data.stops.sort((a, b) => a.t - b.t)
  const vans = data.vans.map((v) => ({
    ...v,
    start: v.times[0],
    end: v.times[v.times.length - 1],
    lastHeading: 0,
  }))

  // Running totals over pickups, so any moment's counts are one lookup.
  const pickups = stops.filter((s) => s.kind === 'P')
  let done = 0
  let onTime = 0
  let late = 0
  let noShow = 0
  const totals = pickups.map((s) => {
    if (s.status === 'no_show') noShow += 1
    else {
      done += 1
      if (s.onTime) onTime += 1
      else late += 1
    }
    return { t: s.t, done, onTime, late, noShow }
  })

  // Late pickups per 15 minutes, for the timeline.
  const bins = {}
  for (const s of pickups) {
    if (s.status !== 'no_show' && !s.onTime) {
      const b = Math.floor(s.t / 15)
      bins[b] = (bins[b] || 0) + 1
    }
  }

  return {
    meta: data.meta,
    vans,
    vansById: Object.fromEntries(vans.map((v) => [v.id, v])),
    stops,
    pickups,
    totals,
    lateBins: bins,
    trails: vans.map((v) => ({ id: v.id, path: v.path, timestamps: v.times })),
  }
}

// Just the position at time t, with no side effects (for looking ahead).
export function positionAt(van, t) {
  const { path, times } = van
  const ct = Math.min(Math.max(t, van.start), van.end)
  const i = Math.max(0, Math.min(floorIndex(times, ct), times.length - 2))
  const span = times[i + 1] - times[i]
  const f = span > 0 ? Math.min(1, Math.max(0, (ct - times[i]) / span)) : 1
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f]
}

// Which way the road goes over the next stretch: steadier than the current
// segment's heading, which jumps at every vertex. Null when the van is parked.
export function headingAhead(van, t, minutes = 0.35) {
  const a = positionAt(van, t)
  const b = positionAt(van, t + minutes)
  const metersApart = Math.hypot((b[0] - a[0]) * 88_000, (b[1] - a[1]) * 111_000)
  return metersApart > 12 ? bearing(a, b) : null
}

// When a van that is standing at time t (at a stop) drives off again.
export function departure(van, t) {
  const { path, times } = van
  let i = Math.max(0, floorIndex(times, t))
  while (i + 1 < times.length && path[i + 1][0] === path[i][0] && path[i + 1][1] === path[i][1]) i += 1
  return times[i]
}

// Where a van is at time t: position, heading (degrees from north), moving?
export function vanState(van, t) {
  if (t < van.start || t > van.end) return null
  const { path, times } = van
  const i = Math.max(0, Math.min(floorIndex(times, t), times.length - 2))
  const t0 = times[i]
  const t1 = times[i + 1]
  const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1
  const a = path[i]
  const b = path[i + 1]
  const pos = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  const moving = t1 > t0 && (a[0] !== b[0] || a[1] !== b[1])
  if (moving) van.lastHeading = bearing(a, b)
  const bi = floorIndex(van.behind, t, (s) => s[0])
  return {
    id: van.id,
    pos,
    heading: van.lastHeading,
    moving,
    behind: bi >= 0 ? van.behind[bi][1] : 0,
  }
}

// The road ahead of a van for the next `minutes`, starting at its position now.
export function routeAhead(van, t, minutes = 45) {
  const state = vanState(van, t)
  if (!state) return []
  const out = [state.pos]
  for (let i = floorIndex(van.times, t) + 1; i < van.times.length; i += 1) {
    if (van.times[i] > t + minutes) break
    out.push(van.path[i])
  }
  return out
}

export function totalsAt(fleet, t) {
  const i = floorIndex(fleet.totals, t, (s) => s.t)
  return i >= 0 ? fleet.totals[i] : { done: 0, onTime: 0, late: 0, noShow: 0 }
}

// Stop events between t0 and t (inclusive), newest last.
export function stopsBetween(fleet, t0, t) {
  const hi = floorIndex(fleet.stops, t, (s) => s.t)
  const out = []
  for (let i = hi; i >= 0 && fleet.stops[i].t >= t0; i -= 1) out.push(fleet.stops[i])
  return out.reverse()
}

export function nextStops(fleet, vanId, t, n = 3) {
  const out = []
  for (const s of fleet.stops) {
    if (s.van === vanId && s.t > t) {
      out.push(s)
      if (out.length === n) break
    }
  }
  return out
}

// The main reasons a pickup was late, biggest first.
export function causesOf(stop) {
  const causes = Object.entries(stop.causes || {}).map(([k, v]) => [k, v])
  if (stop.inherited > 0.5) causes.push(['inherited', stop.inherited])
  return causes.sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: CAUSE_LABELS[k] || k, minutes: v }))
}
