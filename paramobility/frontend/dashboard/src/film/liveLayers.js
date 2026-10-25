import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { vanState } from '../sim/fleet.js'
import { forecast, positionAtKm } from './forecast.js'
import { LABEL_CHARS } from './warm.js'

// The live story's drawing: Maria, the clinic, her route, the van, and the
// forecast as "ghost vans": one dot per way the ride could go, placed where
// that van would be when the appointment starts. Ghosts that make it gather
// in a bloom around the clinic; the late ones hang back along the route. So
// the share of dots at the clinic is the chance of arriving on time.

export const STAGES = [
  'paratransit', 'scale', 'window', 'maria', 'route', 'pickup', 'forecast', 'setback',
  'ask', 'call', 'moved', 'drive', 'arrive', 'why', 'how', 'end',
]
const S = Object.fromEntries(STAGES.map((id, i) => [id, i]))
const INK = [20, 22, 24]
const GRAY = [107, 110, 114]
const ACCENT = [74, 59, 184]
const WARN = [217, 130, 43]
const WHITE = [255, 255, 255]
const PAGE = [245, 245, 243]
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false }
const FONT = { fontFamily: '"Instrument Sans", sans-serif', fontWeight: 600, characterSet: LABEL_CHARS, parameters: ON_TOP }
const BURST_S = 0.9

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const easeOut = (p) => 1 - (1 - p) ** 3
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)
const fadeIn = (since, delay, dur) => easeOut(clamp01((since - delay) / dur))
const alpha = (color, a) => [...color, Math.round(255 * a)]
const pop = (x) => (x <= 0 ? 0 : 1 - Math.exp(-7 * x) * Math.cos(12 * x))
const bump = (x) => (x <= 0 ? 1 : 1 + 0.3 * Math.exp(-5 * x) * Math.sin(12 * x))
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]

// The fixed pieces, made once so deck.gl keeps their buffers.
const prepared = new WeakMap()
function prepare(live) {
  if (prepared.has(live)) return prepared.get(live)
  const { ride } = live
  const van = ride.van
  const before = van.path.filter((_, i) => van.times[i] >= ride.pickup.t - 8 && van.times[i] <= ride.pickup.t)
  const p = {
    home: { pos: ride.pickup.pos, text: live.name },
    clinic: { pos: ride.dropoff.pos },
    route: ride.route.map((r) => r.pos),
    approach: before.length > 1 ? before : [],
    clinicLabel: {
      before: { pos: ride.dropoff.pos, text: `${live.clinicShort} · ${live.appointmentLabel}` },
      after: { pos: ride.dropoff.pos, text: `${live.clinicShort} · ${live.newAppointmentLabel}` },
    },
    // One array per set of labels shown, so deck.gl lays the text out once.
    labelSets: new Map(),
  }
  prepared.set(live, p)
  return p
}

// Ghosts that made it, arranged as a sunflower around the clinic: offsets in
// pixels, turned into degrees at the current zoom so the bloom stays one size.
function bloom(center, n, zoom) {
  const mpp = (40075016 * Math.cos((center[1] * Math.PI) / 180)) / (512 * 2 ** zoom)
  const out = []
  for (let i = 0; i < n; i += 1) {
    const r = 5 * Math.sqrt(i + 0.6)
    const a = i * 2.39996
    const dx = r * Math.cos(a) * mpp
    const dy = r * Math.sin(a) * mpp
    out.push([center[0] + dx / (111320 * Math.cos((center[1] * Math.PI) / 180)), center[1] + dy / 110540])
  }
  return out
}

// Where each ghost is drawn, for one forecast.
function ghostPositions(live, f, zoom) {
  const made = f.ghosts.filter((g) => g.onTime)
  const at = bloom(live.ride.dropoff.pos, made.length, zoom)
  let m = 0
  return f.ghosts.map((g) => (g.onTime ? at[m++] : positionAtKm(live.ride, g.k)))
}

const fired = new Map()

export function buildLiveLayers({ live, scene, since, elapsed, t, pulse, zoom }) {
  const stage = STAGES.indexOf(scene.id)
  const p = prepare(live)
  const { ride } = live
  const aboard = t >= ride.pickup.t
  const inPlay = (from, to = S.arrive) => (stage >= from && stage <= to ? 1 : 0)

  // Bursts: fire as the story's clock passes them, then play in real time.
  for (const b of live.bursts) {
    if (elapsed < b.at) fired.delete(b)
    else if (elapsed < b.at + 2 && !fired.has(b)) fired.set(b, pulse)
  }
  const vanNow = vanState(ride.van, t)
  const where = (b) => (b.where === 'clinic' ? ride.dropoff.pos : b.where === 'van' && vanNow ? vanNow.pos : ride.pickup.pos)
  const bursts = [...fired]
    .map(([b, start]) => ({ ...b, k: (pulse - start) / BURST_S, pos: where(b) }))
    .filter((b) => b.k >= 0 && b.k <= 1)
  const homeBursts = [...fired].filter(([b]) => b.where === 'home').map(([, s]) => s)
  const lastHome = homeBursts.length ? Math.max(...homeBursts) : -99

  // Maria pops in, then waits at home until the van takes her.
  const mariaScale = stage === S.maria ? pop(since - 0.35) : bump(pulse - lastHome)
  const mariaShown = stage >= S.maria && stage <= S.pickup && !aboard ? clamp01(mariaScale * 4) : 0
  const labelShown = stage === S.maria ? clamp01(pop(since - 0.7) * 3) : mariaShown
  const clinicScale = stage === S.route ? pop(since - 0.25) : 1
  const clinicShown = stage === S.route ? clamp01(clinicScale * 3) : inPlay(S.route)
  const routeShown = stage === S.route ? fadeIn(since, 0.5, 2.2) : inPlay(S.route)
  const vanShown = stage === S.pickup ? fadeIn(since, 0.1, 0.5) : inPlay(S.pickup)

  // The forecast and its ghosts. When the appointment moves, the ghosts
  // glide from the old forecast to the new one.
  const ghostsShown = stage === S.forecast ? fadeIn(since, 0.3, 0.9) : inPlay(S.forecast)
  const moved = stage >= S.moved
  const by = moved ? live.newAppointment : live.appointment
  let ghosts = []
  if (ghostsShown && t >= ride.depart - 0.01) {
    const f = forecast(ride, t, by)
    let pos = ghostPositions(live, f, zoom)
    if (stage === S.moved) {
      const k = easeInOut(clamp01((since - 0.4) / 1.4))
      const before = ghostPositions(live, forecast(ride, t, live.appointment), zoom)
      pos = pos.map((q, i) => lerp2(before[i], q, k))
    }
    ghosts = f.ghosts.map((g, i) => ({ pos: pos[i], onTime: g.onTime }))
  }
  const clinicLabel = moved ? p.clinicLabel.after : p.clinicLabel.before
  const labelKey = `${labelShown > 0}${clinicShown > 0}${moved}`
  if (!p.labelSets.has(labelKey)) {
    p.labelSets.set(labelKey, [...(labelShown ? [p.home] : []), ...(clinicShown ? [clinicLabel] : [])])
  }

  return [
    new PathLayer({
      id: 'live-approach',
      data: vanShown && !aboard && p.approach.length ? [{ path: p.approach }] : [],
      getPath: (d) => d.path,
      getColor: alpha(INK, 0.25 * vanShown),
      getWidth: 3,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      parameters: ON_TOP,
    }),
    new PathLayer({
      id: 'live-route',
      data: routeShown ? [{ path: partial(p.route, stage === S.route ? routeShown : 1) }] : [],
      getPath: (d) => d.path,
      getColor: alpha(ACCENT, 0.55 * (stage === S.route ? 1 : routeShown)),
      getWidth: 4,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'live-ghosts',
      data: ghosts,
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 3.6,
      getFillColor: (d) => alpha(d.onTime ? ACCENT : WARN, (d.onTime ? 0.6 : 0.75) * ghostsShown),
      updateTriggers: { getFillColor: ghostsShown },
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'live-clinic',
      data: clinicShown ? [p.clinic] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 7 * clinicScale,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2.5,
      getFillColor: alpha(WHITE, clinicShown),
      getLineColor: alpha(INK, clinicShown),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'live-burst',
      data: bursts,
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: (d) => 12 + 52 * easeOut(d.k),
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      getLineWidth: 2.5,
      getLineColor: (d) => alpha(d.color === 'warn' ? WARN : ACCENT, 0.7 * (1 - d.k) ** 1.5),
      updateTriggers: { getRadius: pulse, getLineColor: pulse },
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'live-van',
      data: vanShown && vanNow ? [vanNow] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 7.5,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2.5,
      // Ink on its way to her; purple once Maria is aboard.
      getFillColor: alpha(aboard ? ACCENT : INK, vanShown),
      getLineColor: alpha(WHITE, vanShown),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'live-maria-glow',
      data: mariaShown ? [p.home] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 26 * mariaScale,
      getFillColor: alpha(ACCENT, 0.12 * mariaShown),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'live-maria',
      data: mariaShown ? [p.home] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 10 * mariaScale,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      getFillColor: alpha(ACCENT, mariaShown),
      getLineColor: alpha(WHITE, mariaShown),
      parameters: ON_TOP,
    }),
    new TextLayer({
      id: 'live-labels',
      data: p.labelSets.get(labelKey),
      getPosition: (d) => d.pos,
      getText: (d) => d.text,
      getSize: 15,
      getColor: (d) => (d === p.home ? alpha(ACCENT, labelShown) : alpha(GRAY, clinicShown)),
      getPixelOffset: [0, 30],
      background: true,
      backgroundPadding: [6, 2],
      getBackgroundColor: (d) => alpha(PAGE, d === p.home ? labelShown : clinicShown),
      updateTriggers: { getColor: [labelShown, clinicShown], getBackgroundColor: [labelShown, clinicShown] },
      ...FONT,
    }),
  ]
}

// The first `k` (0-1) of a path, by length.
function partial(path, k) {
  if (k >= 1) return path
  const seg = path.slice(1).map((pt, i) => Math.hypot(pt[0] - path[i][0], pt[1] - path[i][1]))
  let left = seg.reduce((a, b) => a + b, 0) * k
  const out = [path[0]]
  for (let i = 0; i < seg.length; i += 1) {
    if (left >= seg[i]) {
      out.push(path[i + 1])
      left -= seg[i]
    } else {
      const f = seg[i] ? left / seg[i] : 0
      out.push(lerp2(path[i], path[i + 1], f))
      break
    }
  }
  return out
}
