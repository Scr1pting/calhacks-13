// The film: a directed, roughly two-minute tour of the simulated day that
// tells the rider's problem through Maria's morning. Each scene sets the sim
// clock (t0 -> t1, minutes after midnight), the camera, and a caption. Every
// number in a caption is computed from the day's data, nothing is typed in.
//
// Pacing: the sim clock runs at most about a minute per second, so the vans
// move at a believable speed. Long waits are skipped with a cut (`cut: true`,
// a soft flash), not by fast-forwarding.
//
// Camera: `to` is where the scene's shot ends; it starts from wherever the
// previous shot left the camera, or from `from` (a cut to a new angle).
// `follow` is a chase shot behind a van instead, and `pan` a steady pan from
// `pan.from` to `pan.to` that the camera eases onto over `pan.rise` seconds.

import { clock, departure, vanState } from '../sim/fleet.js'

const parseClock = (s) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const word = (n) => WORDS[n] ?? String(n)
const Word = (n) => word(n).replace(/^./, (c) => c.toUpperCase())
const area = (place) => place.match(/\(([^/)]+)/)?.[1]?.trim() || 'Oakland'
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)

// A shot with `ease: true` runs the clock eased, so its van pulls away gently
// and slows into the stop the shot ends on: a clean place to pause.
export const easeStop = ease

// How far into a scene (seconds) its clock reaches sim time t.
export function secondsTo(scene, t) {
  const k = (t - scene.t[0]) / (scene.t[1] - scene.t[0])
  if (!scene.ease) return k * scene.dur
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2
    if (ease(mid) < k) lo = mid
    else hi = mid
  }
  return lo * scene.dur
}

// How many of the day's late pickups the whole-day shot shows, p of the way in.
export const revealCount = (p, total) => Math.round(ease(p) * total)

export function filmScenes(fleet, maria) {
  const persona = fleet.meta.persona
  const name = persona.name
  const served = fleet.pickups.filter((s) => s.status !== 'no_show')
  const late = served.filter((s) => !s.onTime)
  const inherited = late.filter((s) => s.inherited > 0.5).length / late.length
  const perVan = Math.round(served.length / fleet.vans.length)

  const windowStart = parseClock(maria.pickup.window[0])
  const windowEnd = parseClock(maria.pickup.window[1])
  const appointment = parseClock(persona.appointment)
  const van = fleet.vansById[maria.van_id]
  const behindAtClose = vanState(van, windowEnd + 0.5)?.behind ?? 0
  // Riders the van picks up after Maria's window closed, before Maria.
  const first = fleet.stops.filter(
    (s) => s.van === maria.van_id && s.kind === 'P' && s.t > windowEnd && s.t < maria.pickup.t,
  )
  const afterAppointment = Math.round(maria.pickup.t - appointment)
  const home = maria.pickup.pos
  const purpose = persona.purpose === 'dialysis' ? 'dialysis' : 'appointment'
  const what = persona.purpose === 'dialysis' ? 'dialysis' : 'the appointment'
  const chase = { follow: maria.van_id, zoom: 16.3, pitch: 63, info: true }

  // The chase runs stop to stop: each shot ends as the van pulls up at a
  // pickup, so every pause lands on a van standing still. One shot per
  // pickup before Maria's, the last of them ending at her door.
  const firstBeats = first.map((s, i) => {
    const next = first[i + 1]
    return {
      id: `stop-${i}`,
      dur: next ? 7 : 14,
      t: [departure(van, s.t), next ? next.t : maria.pickup.t],
      ease: true,
      ...chase,
      eyebrow: `${clock(s.t)} · ${area(s.place)}`,
      title: i === 0 ? `A rider picked up ${Math.round(s.late)} minutes late.` : `Another, ${Math.round(s.late)} minutes late.`,
      line: next
        ? `That delay came from the stops before, and it rolls on to ${name}.`
        : `Next stop: ${name}. ${what.replace(/^./, (c) => c.toUpperCase())} starts at ${clock(appointment)}.`,
    }
  })
  const leaves = departure(van, maria.pickup.t)

  return [
    {
      id: 'dawn',
      dur: 10,
      t: [7 * 60 + 50, 7 * 60 + 58],
      from: { center: [-122.2765, 37.7995], zoom: 15.1, pitch: 64, bearing: -44 },
      to: { center: [-122.2705, 37.8045], zoom: 14.6, pitch: 60, bearing: -22 },
      eyebrow: `A simulated ${fleet.meta.weekday === 'Tue' ? 'Tuesday' : 'day'} in the East Bay`,
      title: `${fleet.vans.length} vans. ${served.length.toLocaleString('en-US')} pickups.`,
      line: 'Every rider gets the same promise: the van comes sometime within a 30-minute window.',
    },
    {
      id: 'rush',
      dur: 11,
      t: [7 * 60 + 58, 8 * 60 + 9],
      to: { center: [-122.258, 37.806], zoom: 13.4, pitch: 56, bearing: 4 },
      eyebrow: 'Shared rides',
      title: `Each van strings together about ${perVan} rides.`,
      line: `When one stop runs long, every rider after it inherits the delay. ${Math.round(inherited * 100)} in 100 late pickups today carried delay from an earlier stop.`,
    },
    {
      id: 'maria',
      dur: 11,
      t: [windowStart - 9, windowStart],
      cut: true,
      from: { center: home, zoom: 16.2, pitch: 58, bearing: 6 },
      to: { center: home, zoom: 16.9, pitch: 64, bearing: -20 },
      info: true,
      eyebrow: `Meet ${name}`,
      title: `${purpose === 'dialysis' ? 'Dialysis' : 'An appointment'} at ${clock(appointment).replace(/ [AP]M$/, '')}.`,
      line: `${name}’s van is due at home in ${area(maria.pickup.place)} between ${maria.pickup.window[0]} and ${maria.pickup.window[1]}.`,
    },
    {
      id: 'window',
      dur: 10,
      t: [windowEnd - 4, windowEnd],
      cut: true,
      from: { center: home, zoom: 17.5, pitch: 70, bearing: -70 },
      to: { center: home, zoom: 17.1, pitch: 66, bearing: -48 },
      info: true,
      eyebrow: `${Math.round(windowEnd - 4 - windowStart)} minutes later`,
      title: `${clock(windowEnd).replace(/ [AP]M$/, '')}. The window closes.`,
      line: 'No van yet, and no way to see where it is. Riders can only call dispatch, and wait.',
    },
    {
      id: 'van',
      t: [windowEnd, first.length ? first[0].t : maria.pickup.t],
      ease: true,
      ...chase,
      dur: 10,
      blend: 3.5,
      eyebrow: `Meanwhile, van ${maria.van_id}`,
      title: `${Math.round(behindAtClose)} minutes behind plan.`,
      line:
        first.length > 0
          ? `It still has ${word(first.length)} ${first.length === 1 ? 'rider' : 'riders'} to collect before ${name}.`
          : `${name} is next, but the van is still across town.`,
    },
    ...firstBeats,
    {
      id: 'pickup',
      dur: 9,
      // The van stands at her door while she boards.
      t: [maria.pickup.t, leaves],
      ...chase,
      zoom: 16.8,
      pitch: 60,
      eyebrow: clock(maria.pickup.t),
      title: `${name} is picked up.`,
      line:
        afterAppointment > 0
          ? `${Word(afterAppointment)} minutes after ${what} was due to start.`
          : `${Math.round(maria.pickup.late)} minutes after the window closed.`,
    },
    {
      id: 'day',
      dur: 14,
      t: [leaves, leaves + 8],
      to: { center: [-122.215, 37.79], zoom: 11.35, pitch: 46, bearing: 24 },
      reveal: true,
      hideClock: true,
      eyebrow: 'The whole day',
      title: (t, p) => `${revealCount(p, late.length)} riders picked up late.`,
      line: `About ${Math.round((100 * late.length) / served.length)} in 100 pickups. Reliable on average, unpredictable for the rider who is waiting.`,
    },
    {
      id: 'leeway',
      dur: 14,
      t: [leaves + 8, leaves + 15],
      // Back down into the city for the close, panning across it.
      pan: {
        from: { center: [-122.2712, 37.8102], zoom: 15.3, pitch: 62, bearing: 78 },
        to: { center: [-122.2655, 37.8042], zoom: 14.9, pitch: 58, bearing: 36 },
        rise: 4.5,
      },
      hideClock: true,
      end: true,
    },
  ]
}

export const filmLength = (scenes) => scenes.reduce((a, s) => a + s.dur, 0)

// Which scene is playing `elapsed` seconds in, and how far through it (0-1).
export function sceneAt(scenes, elapsed) {
  let start = 0
  for (let i = 0; i < scenes.length; i += 1) {
    const s = scenes[i]
    if (elapsed < start + s.dur || i === scenes.length - 1) {
      return { index: i, scene: s, start, p: Math.min(1, Math.max(0, (elapsed - start) / s.dur)) }
    }
    start += s.dur
  }
  return null
}
