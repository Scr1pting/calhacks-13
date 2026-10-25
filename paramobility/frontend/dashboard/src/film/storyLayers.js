import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { routeAhead, vanState } from '../sim/fleet.js'
import { vanRun } from './story.js'

// The story's drawing: a few dots and lines on a blank page, each with its own
// entrance. `stage` is the scene's place in the story (see STAGES), `since`
// the seconds into the scene, `elapsed` the seconds into the story, `pulse`
// real time in seconds.

const STAGES = ['maria', 'appointment', 'route', 'opens', 'closes', 'deadline', 'why', 'chain', 'missed', 'arrival', 'leeway', 'end']
const S = Object.fromEntries(STAGES.map((id, i) => [id, i]))
const INK = [20, 22, 24]
const GRAY = [107, 110, 114]
const ACCENT = [74, 59, 184]
const WARN = [217, 130, 43]
const WHITE = [255, 255, 255]
const PAGE = [245, 245, 243]
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false }
const FONT = { fontFamily: '"Instrument Sans", sans-serif', fontWeight: 600, parameters: ON_TOP }

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const easeOut = (p) => 1 - (1 - p) ** 3
// 0 -> 1 over `dur` seconds, starting `delay` seconds into the scene.
const fadeIn = (since, delay, dur) => easeOut(clamp01((since - delay) / dur))
const alpha = (color, a) => [...color, Math.round(255 * a)]
// A spring from 0 to 1, `x` seconds after it starts: overshoots to about 1.16
// and settles within half a second. This is Maria's pop.
const pop = (x) => (x <= 0 ? 0 : 1 - Math.exp(-7 * x) * Math.cos(12 * x))
// A quick swell and settle around 1, for moments that matter.
const bump = (x) => (x <= 0 ? 1 : 1 + 0.3 * Math.exp(-5 * x) * Math.sin(12 * x))
const BURST_S = 0.9
// When each burst fired, in real seconds: they fire as the story's clock
// passes them and then play out in real time, so a shot held in presenter
// mode never freezes a ring mid-air.
const fired = new Map()

// The fixed pieces, made once per day so deck.gl keeps their buffers.
const prepared = new WeakMap()
function prepare(fleet, maria) {
  if (prepared.has(maria)) return prepared.get(maria)
  const van = fleet.vansById[maria.van_id]
  const between = (t0, t1) => van.path.filter((_, i) => van.times[i] > t0 && van.times[i] < t1)
  const { worst, first } = vanRun(fleet, maria)
  const p = {
    van,
    home: [{ pos: maria.pickup.pos, text: maria.name }],
    clinic: [{ pos: maria.dropoff.pos, text: maria.purpose === 'dialysis' ? 'Dialysis' : 'Appointment' }],
    ride: [maria.pickup.pos, ...between(maria.pickup.t, maria.dropoff.t), maria.dropoff.pos],
    // The trip that made the van late, from that rider's home.
    cause: worst ? [worst.from.pos, ...between(worst.from.t, worst.to.t), worst.to.pos] : [],
    causeStart: worst ? [{ pos: worst.from.pos, text: worst.from.place.match(/\(([^/)]+)/)?.[1] ?? '' }] : [],
    before: first.map((s) => ({ pos: s.pos, t: s.t })),
  }
  prepared.set(maria, p)
  return p
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
      out.push([path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f])
      break
    }
  }
  return out
}

export function buildStoryLayers({ fleet, maria, scenes, scene, since, elapsed, t, pulse }) {
  const stage = STAGES.indexOf(scene.id.replace(/-\d+$/, '')) // chain-1 is the chain too
  const p = prepare(fleet, maria)
  const pickedUp = t >= maria.pickup.t && stage <= S.arrival
  const ending = stage === S.end ? 1 - fadeIn(since, 0, 1) : 1
  const inPlay = (from, to = S.leeway) => (stage >= from && stage <= to ? 1 : stage === S.end ? ending : 0)

  // Rings at the key moments.
  for (const b of scenes.bursts ?? []) {
    if (elapsed < b.at) fired.delete(b) // stepped back before it: it may fire again
    else if (elapsed < b.at + 2 && !fired.has(b)) fired.set(b, pulse)
  }
  const bursts = [...fired]
    .map(([b, start]) => ({ ...b, k: (pulse - start) / BURST_S, pos: (b.where === 'clinic' ? p.clinic : p.home)[0].pos }))
    .filter((b) => b.k >= 0 && b.k <= 1)
  const homeBursts = [...fired].filter(([b]) => b.where === 'home').map(([, start]) => start)
  const lastAtHome = homeBursts.length ? Math.max(...homeBursts) : -99

  // Maria pops onto the blank page, swells a little when something happens
  // to her, and stays until the van picks her up. Leeway's scene shows her
  // at home again: the same morning, told differently.
  const mariaScale = stage === S.maria ? pop(since - 0.35) : bump(pulse - lastAtHome)
  let mariaShown = clamp01(mariaScale * 4)
  if (pickedUp) mariaShown = 0
  if (stage === S.leeway) mariaShown = fadeIn(since, 0, 0.6)
  if (stage === S.end) mariaShown = ending
  const labelScale = stage === S.maria ? pop(since - 0.65) : 1
  const labelsShown = clamp01(labelScale * 3) * inPlay(S.maria)
  const clinicScale = stage === S.appointment ? pop(since - 0.3) : 1
  const clinicShown = (stage === S.appointment ? clamp01(clinicScale * 3) : 1) * inPlay(S.appointment)
  const routeShown = stage === S.route ? fadeIn(since, 0.3, 2) : inPlay(S.route)
  // While she waits: a ripple every 2.2 seconds.
  const waiting = stage >= S.opens && stage <= S.arrival && !pickedUp
  const ripple = (pulse % 2.2) / 2.2

  // The van: it appears when we ask where it is, and drives to her.
  const vanShown = stage === S.why ? fadeIn(since, 0.3, 0.6) : stage > S.why && stage <= S.arrival ? 1 : 0
  const vanNow = vanShown ? vanState(p.van, t) : null
  const ahead = vanNow && !pickedUp ? routeAhead(p.van, t, maria.pickup.t - t) : []
  // The trip that made it late, drawn in while we explain it.
  const causeShown = stage === S.why ? fadeIn(since, 0.6, 2.6) : scene.id === 'chain' ? 1 - fadeIn(since, 0, 1.5) : 0
  const causeLabel = stage === S.why ? fadeIn(since, 2.6, 0.6) : scene.id === 'chain' ? causeShown : 0

  return [
    new PathLayer({
      id: 'story-cause',
      data: causeShown && p.cause.length > 1 ? [{ path: stage === S.why ? partial(p.cause, causeShown) : p.cause }] : [],
      getPath: (d) => d.path,
      getColor: alpha(WARN, 0.9 * (stage === S.why ? 1 : causeShown)),
      getWidth: 4,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true,
      parameters: ON_TOP,
    }),
    new PathLayer({
      id: 'story-ride',
      data: routeShown ? [{ path: partial(p.ride, stage === S.route ? routeShown : 1) }] : [],
      getPath: (d) => d.path,
      getColor: alpha(ACCENT, 0.85 * (stage === S.route ? 1 : routeShown)),
      getWidth: 5,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true,
      parameters: ON_TOP,
    }),
    new PathLayer({
      id: 'story-van-ahead',
      data: ahead.length > 1 ? [{ path: ahead }] : [],
      getPath: (d) => d.path,
      getColor: alpha(INK, 0.3 * vanShown),
      getWidth: 3,
      widthUnits: 'pixels',
      jointRounded: true,
      capRounded: true,
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'story-before',
      data: vanShown ? p.before : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 6,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      // A stop turns orange once the van has picked that rider up, late.
      getFillColor: (d) => (t >= d.t ? alpha(WARN, vanShown) : alpha(WHITE, vanShown)),
      getLineColor: (d) => (t >= d.t ? alpha(WHITE, vanShown) : alpha(GRAY, vanShown)),
      updateTriggers: { getFillColor: [t, vanShown], getLineColor: [t, vanShown] },
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'story-clinic',
      data: clinicShown ? p.clinic : [],
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
      id: 'story-ripple',
      data: waiting ? p.home : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 11 + 24 * easeOut(ripple),
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      getLineColor: alpha(ACCENT, 0.55 * (1 - ripple)),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'story-burst',
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
      id: 'story-van',
      data: vanNow ? [vanNow] : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 7,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      // Ink while it's on its way; purple once Maria is aboard.
      getFillColor: alpha(pickedUp ? ACCENT : INK, vanShown),
      getLineColor: alpha(WHITE, vanShown),
      parameters: ON_TOP,
    }),
    // A soft glow behind Maria, so her dot carries on the blank page.
    new ScatterplotLayer({
      id: 'story-maria-glow',
      data: mariaShown ? p.home : [],
      getPosition: (d) => d.pos,
      radiusUnits: 'pixels',
      getRadius: 26 * mariaScale,
      getFillColor: alpha(ACCENT, 0.12 * mariaShown),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'story-maria',
      data: mariaShown ? p.home : [],
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
      id: 'story-labels',
      data: [
        ...(labelsShown && mariaShown ? p.home : []),
        ...(clinicShown && labelsShown ? p.clinic : []),
        ...(causeLabel ? p.causeStart : []),
      ],
      getPosition: (d) => d.pos,
      getText: (d) => d.text,
      getSize: (d) => 16 * (d === p.home[0] ? labelScale : d === p.clinic[0] ? clinicScale : 1),
      getColor: (d) =>
        d === p.home[0]
          ? alpha(ACCENT, labelsShown * mariaShown)
          : d === p.clinic[0]
            ? alpha(GRAY, clinicShown)
            : alpha(WARN, causeLabel),
      getPixelOffset: [0, 30],
      // A backing in the page colour, so a route line never runs through a label.
      background: true,
      backgroundPadding: [6, 2],
      getBackgroundColor: (d) =>
        alpha(PAGE, d === p.home[0] ? labelsShown * mariaShown : d === p.clinic[0] ? clinicShown : causeLabel),
      updateTriggers: {
        getSize: [labelScale, clinicScale],
        getColor: [labelsShown, clinicShown, mariaShown, causeLabel],
        getBackgroundColor: [labelsShown, clinicShown, mariaShown, causeLabel],
      },
      ...FONT,
    }),
  ]
}
