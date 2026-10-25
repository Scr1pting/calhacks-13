import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { vanState } from '../sim/fleet.js'
import { DASHED, LABEL_CHARS } from './warm.js'

// The presentation's drawing, like the live story's (liveLayers.js): the
// rider, the clinic, the trip as she booked it (a dashed line from her door
// to the clinic), and the van. Nobody told her the van is shared, so its
// path is drawn only as it drives, and each of its other stops appears when
// the van gets there, with a ring and a label that fades.

export const STAGES = [
  'paratransit', 'scale', 'window', 'rider', 'booked', 'wait', 'arrives', 'pickup', 'detour',
  'ask', 'call', 'informed', 'drive', 'arrive', 'why', 'how', 'end',
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
const STOP_LABEL_S = [2.6, 3.4] // a stop's label holds, then is gone by

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const easeOut = (p) => 1 - (1 - p) ** 3
const fadeIn = (since, delay, dur) => easeOut(clamp01((since - delay) / dur))
const alpha = (color, a) => [...color, Math.round(255 * a)]
const pop = (x) => (x <= 0 ? 0 : 1 - Math.exp(-7 * x) * Math.cos(12 * x))
const bump = (x) => (x <= 0 ? 1 : 1 + 0.3 * Math.exp(-5 * x) * Math.sin(12 * x))
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]

// The fixed pieces, made once so deck.gl keeps their buffers.
const prepared = new WeakMap()
function prepare(pres) {
  if (prepared.has(pres)) return prepared.get(pres)
  const { ride } = pres
  const p = {
    home: { pos: ride.pickup.pos, text: pres.name },
    clinic: { pos: ride.dropoff.pos, text: `${pres.clinic} · ${pres.appointmentLabel}` },
    booked: [ride.pickup.pos, ride.dropoff.pos],
    stops: pres.stops.map((s) => ({ pos: s.pos, t: s.t, text: s.label })),
    // One array per set of labels shown, so deck.gl lays the text out once.
    labelSets: new Map(),
  }
  prepared.set(pres, p)
  return p
}

// The van's path from her door up to time t.
function driven(ride, t, vanNow) {
  const path = []
  for (const r of ride.route) {
    if (r.t > t) break
    path.push(r.pos)
  }
  if (vanNow) path.push(vanNow.pos)
  return path.length > 1 ? path : []
}

const fired = new Map()

export function buildPresentationLayers({ pres, scene, since, elapsed, t, pulse }) {
  const stage = STAGES.indexOf(scene.id)
  const p = prepare(pres)
  const { ride } = pres
  const aboard = t >= ride.pickup.t
  const inPlay = (from, to = S.arrive) => (stage >= from && stage <= to ? 1 : 0)

  // Bursts: fire as the story's clock passes them, then play in real time.
  for (const b of pres.bursts) {
    if (elapsed < b.at) fired.delete(b)
    else if (elapsed < b.at + 2 && !fired.has(b)) fired.set(b, pulse)
  }
  const vanNow = vanState(ride.van, t)
  const where = (b) => {
    if (Array.isArray(b.where)) return b.where
    if (b.where === 'clinic') return ride.dropoff.pos
    return b.where === 'van' && vanNow ? vanNow.pos : ride.pickup.pos
  }
  const bursts = [...fired]
    .map(([b, start]) => ({ ...b, k: (pulse - start) / BURST_S, pos: where(b) }))
    .filter((b) => b.k >= 0 && b.k <= 1)
  const homeBursts = [...fired].filter(([b]) => b.where === 'home').map(([, s]) => s)
  const lastHome = homeBursts.length ? Math.max(...homeBursts) : -99

  // She pops in, then waits at home until the van takes her.
  const riderScale = stage === S.rider ? pop(since - 0.35) : bump(pulse - lastHome)
  const riderShown = stage >= S.rider && stage <= S.pickup && !aboard ? clamp01(riderScale * 4) : 0
  const labelShown = stage === S.rider ? clamp01(pop(since - 0.7) * 3) : riderShown
  // At the pickup, the way she should go: the line to the hospital draws, the hospital pops in.
  const clinicScale = stage === S.pickup ? pop(since - 0.9) : 1
  const clinicShown = stage === S.pickup ? clamp01(clinicScale * 3) : inPlay(S.pickup)
  const bookedShown = stage === S.pickup ? fadeIn(since, 0.3, 1.8) : inPlay(S.pickup)
  // The van, once it comes into the picture: ink on its way to her, purple with her aboard.
  const vanShown = vanNow && stage >= S.wait ? inPlay(S.wait) : 0

  // The van's other stops: once the van heads off (the detour), where it's going
  // shows with its label, so the detour has a reason; a ring when the van gets
  // there, the label a moment more, then a faint mark.
  const heading = stage >= S.detour && stage <= S.arrive
  const stopFired = p.stops.map((_, i) => [...fired].find(([b]) => b.stop === i)?.[1])
  const stopScale = p.stops.map((s, i) =>
    stopFired[i] != null ? Math.max(0.01, pop(pulse - stopFired[i])) : stage === S.detour ? Math.max(0.01, pop(since - 0.4)) : 1,
  )
  const stopShown = p.stops.map((s, i) => {
    if (!aboard || !heading) return 0
    if (t < s.t) return stage === S.detour ? clamp01(pop(since - 0.4) * 3) : 1
    return stopFired[i] == null ? 0.45 : 1
  })
  const stopLabel = p.stops.map((s, i) => {
    if (!stopShown[i]) return 0
    if (t < s.t) return stopShown[i] // on the way there
    if (stopFired[i] == null) return 0
    const age = pulse - stopFired[i]
    return 1 - clamp01((age - STOP_LABEL_S[0]) / (STOP_LABEL_S[1] - STOP_LABEL_S[0]))
  })

  const labels = [
    ...(labelShown ? [p.home] : []),
    ...(clinicShown ? [p.clinic] : []),
    ...p.stops.filter((s, i) => stopLabel[i] > 0),
  ]
  const labelKey = labels.map((l) => l.text).join('|')
  if (!p.labelSets.has(labelKey)) p.labelSets.set(labelKey, labels)
  const shownOf = (d) => (d === p.home ? labelShown : d === p.clinic ? clinicShown : stopLabel[p.stops.indexOf(d)])

  return [
    new PathLayer({
      id: 'pres-booked',
      data: bookedShown ? [{ path: partial(p.booked, stage === S.pickup ? bookedShown : 1) }] : [],
      getPath: (d) => d.path,
      getColor: alpha(ACCENT, 0.55 * (stage === S.pickup ? 1 : bookedShown)),
      getWidth: 2.5,
      widthUnits: 'pixels',
      capRounded: true,
      getDashArray: [5, 4],
      dashJustified: true,
      extensions: [DASHED],
      parameters: ON_TOP,
    }),
    new PathLayer({
      id: 'pres-driven',
      data: aboard && vanShown ? [{ path: driven(ride, t, vanNow) }] : [],
      getPath: (d) => d.path,
      getColor: alpha(ACCENT, 0.7),
      getWidth: 4,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'pres-stops',
      data: p.stops,
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: (d) => 5.5 * stopScale[p.stops.indexOf(d)],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getFillColor: (d) => alpha(WHITE, stopShown[p.stops.indexOf(d)]),
      getLineColor: (d) => alpha(INK, stopShown[p.stops.indexOf(d)]),
      updateTriggers: { getRadius: stopScale.join(), getFillColor: stopShown.join(), getLineColor: stopShown.join() },
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'pres-clinic',
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
      id: 'pres-burst',
      data: bursts,
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: (d) => 12 + 52 * easeOut(d.k),
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      getLineWidth: 2.5,
      getLineColor: (d) => alpha(d.color === 'warn' ? WARN : d.color === 'ink' ? INK : ACCENT, 0.7 * (1 - d.k) ** 1.5),
      updateTriggers: { getRadius: pulse, getLineColor: pulse },
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'pres-van',
      data: vanShown && vanNow ? [vanNow] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 7.5,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2.5,
      getFillColor: alpha(aboard ? ACCENT : INK, vanShown),
      getLineColor: alpha(WHITE, vanShown),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'pres-rider-glow',
      data: riderShown ? [p.home] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 26 * riderScale,
      getFillColor: alpha(ACCENT, 0.12 * riderShown),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'pres-rider',
      data: riderShown ? [p.home] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 10 * riderScale,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      getFillColor: alpha(ACCENT, riderShown),
      getLineColor: alpha(WHITE, riderShown),
      parameters: ON_TOP,
    }),
    new TextLayer({
      id: 'pres-labels',
      data: p.labelSets.get(labelKey),
      getPosition: (d) => d.pos,
      getText: (d) => d.text,
      getSize: (d) => (d === p.home || d === p.clinic ? 15 : 13),
      getColor: (d) => alpha(d === p.home ? ACCENT : d === p.clinic ? GRAY : INK, shownOf(d)),
      getPixelOffset: (d) => [0, d === p.home || d === p.clinic ? 30 : -22],
      background: true,
      backgroundPadding: [6, 2],
      getBackgroundColor: (d) => alpha(PAGE, shownOf(d)),
      updateTriggers: {
        getColor: [labelShown, clinicShown, stopLabel.join()],
        getBackgroundColor: [labelShown, clinicShown, stopLabel.join()],
      },
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
