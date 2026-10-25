// The story: the minimal cut of the film. It starts on a blank page and builds
// the problem one element at a time: Maria, her appointment, her route, her
// pickup window, the latest pickup that still makes it, and then why her van
// can't: it is shared, and one long trip earlier in its run made it late for
// everyone after. Flat and top-down, the map rotated so her home sits left
// and the clinic right; one continuous camera, no cuts.
//
// Scene fields, beyond the film's (script.js): `frame` lists the points the
// shot frames, `basemap` how much of the map shows (style.js setBasemap),
// `jump` starts the shot on its frame instead of moving there, `timeline`
// shows the timeline under the caption, `deadline` marks the latest pickup
// on it, `leewayCall` the moment Leeway would call ahead, and `fleet` draws the
// whole simulated fleet instead of Maria's story. The returned
// list also carries `bursts`: rings that mark key moments, in film seconds.

import { clock, departure, vanState } from '../sim/fleet.js'
import { secondsTo } from './script.js'

const parseClock = (s) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const Word = (n) => WORDS[n] ?? String(n)
const area = (place) => place.match(/\(([^/)]+)/)?.[1]?.trim() || place.split(',')[0]
const short = (t) => clock(t).replace(/ [AP]M$/, '')

function miles([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(a))
}

// The van's run before Maria: the trip that put it furthest behind, and the
// pickups it still had to make after her window closed.
export function vanRun(fleet, maria) {
  const windowEnd = parseClock(maria.pickup.window[1])
  const stops = fleet.stops.filter((s) => s.van === maria.van_id && s.t < maria.pickup.t)
  let worst = null
  for (let i = 1; i < stops.length; i += 1) {
    const gain = stops[i].behind - stops[i - 1].behind
    if (stops[i].kind === 'D' && (!worst || gain > worst.gain)) {
      const from = stops.find((s) => s.trip === stops[i].trip && s.kind === 'P')
      if (from) worst = { gain, from, to: stops[i] }
    }
  }
  const first = stops.filter((s) => s.kind === 'P' && s.t > windowEnd)
  return { worst, first, windowEnd }
}

export function storyScenes(fleet, maria) {
  const persona = fleet.meta.persona
  const name = persona.name
  const windowStart = maria.windowStart
  const { worst, first, windowEnd } = vanRun(fleet, maria)
  const appointment = parseClock(persona.appointment)
  const van = fleet.vansById[maria.van_id]
  const home = maria.pickup.pos
  const clinic = maria.dropoff.pos
  const pair = [home, clinic]
  const rideMinutes = Math.round(maria.dropoff.t - maria.pickup.t)
  const deadline = appointment - rideMinutes
  const arrivedLate = Math.round(maria.dropoff.t - appointment)
  const behind = Math.round(vanState(van, windowEnd + 1)?.behind ?? 0)
  const firstLate = first.length ? Math.floor(Math.min(...first.map((s) => s.late)) / 10) * 10 : 0
  const distance = miles(home, clinic)
  const dialysis = persona.purpose === 'dialysis'
  const what = dialysis ? 'dialysis' : 'the appointment'
  const vanAt = (t) => vanState(van, t)?.pos
  const vanRoute = (t0, t1) => van.path.filter((_, i) => van.times[i] >= t0 && van.times[i] <= t1)
  const chainFrame = [...pair, ...first.map((s) => s.pos), vanAt(windowEnd + 3)].filter(Boolean)

  const scenes = [
    {
      id: 'maria',
      dur: 5.5,
      t: [windowStart - 25, windowStart - 24],
      frame: [home],
      maxZoom: 15.6,
      jump: true,
      basemap: 'blank',
      title: `This is ${name}.`,
      line: `${name} lives in ${area(maria.pickup.place)} and rides East Bay Paratransit.`,
    },
    {
      id: 'appointment',
      dur: 5,
      t: [windowStart - 24, windowStart - 23],
      frame: pair,
      maxZoom: 15.6,
      title: `${dialysis ? 'Dialysis' : 'An appointment'} at ${short(appointment)}.`,
      line: `The ${dialysis ? 'dialysis center' : 'clinic'} is ${distance < 1 ? `${distance.toFixed(1)} miles` : `${Math.round(distance)} miles`} from home.`,
    },
    {
      id: 'route',
      dur: 5.5,
      t: [windowStart - 23, windowStart - 22],
      frame: pair,
      maxZoom: 15.4,
      basemap: 'streets',
      title: `A ${rideMinutes}-minute ride.`,
      line: `The van comes to the door, sometime between ${maria.pickup.window[0]} and ${maria.pickup.window[1]}.`,
    },
    {
      id: 'opens',
      dur: 4.5,
      t: [windowStart - 3, windowStart + 6],
      frame: pair,
      maxZoom: 15.4,
      timeline: true,
      title: `${short(windowStart)}. The window opens.`,
      line: `${name} is ready, and waiting.`,
    },
    {
      id: 'closes',
      dur: 5,
      t: [windowStart + 6, windowEnd],
      frame: pair,
      maxZoom: 15.4,
      timeline: true,
      title: `${short(windowEnd)}. The window closes.`,
      line: 'No van, and no way to see where it is.',
    },
    {
      id: 'deadline',
      dur: 5.5,
      t: [windowEnd, windowEnd + 0.01],
      frame: pair,
      maxZoom: 15.4,
      timeline: true,
      deadline: true,
      title: `To make ${short(appointment)}, the van must come by ${short(deadline)}.`,
      line: `The ride takes ${rideMinutes} minutes. So where is the van?`,
    },
    {
      id: 'why',
      dur: 7.5,
      t: [windowEnd + 0.01, windowEnd + 0.02],
      frame: [home, ...(worst ? vanRoute(worst.from.t, worst.to.t) : [])],
      maxZoom: 15,
      timeline: true,
      deadline: true,
      title: 'The van is shared.',
      line: worst
        ? `Before ${name}, it drove a rider in from ${area(worst.from.place)}. That one trip put it ${Math.round(worst.gain)} minutes behind.`
        : `It is ${behind} minutes behind plan.`,
    },
    // From here each shot runs from the van leaving one stop to it pulling up
    // at the next, so every pause lands on a van standing still.
    ...first.map((s, i) => ({
      id: i === 0 ? 'chain' : `chain-${i}`,
      dur: i === 0 ? 5.5 : 4.5,
      t: [departure(van, i === 0 ? windowEnd + 0.02 : first[i - 1].t), s.t],
      ease: true,
      frame: chainFrame,
      maxZoom: 15.2,
      timeline: true,
      deadline: true,
      title: i === 0 ? `${Word(first.length)} more ${first.length === 1 ? 'rider comes' : 'riders come'} first.` : 'The delay passes down the line.',
      line:
        i === 0
          ? `The first, in ${area(s.place)}, is picked up ${Math.round(s.late)} minutes late.`
          : `The next is picked up ${Math.round(s.late)} minutes late.`,
    })),
    {
      id: 'missed',
      dur: 6,
      t: [departure(van, first.length ? first.at(-1).t : windowEnd + 0.02), maria.pickup.t],
      ease: true,
      frame: chainFrame,
      maxZoom: 15.2,
      timeline: true,
      deadline: true,
      title: 'Too late to make it.',
      line: `${short(deadline)} passes with the van still on its way to ${name}.`,
    },
    {
      id: 'arrival',
      dur: 5.5,
      t: [departure(van, maria.pickup.t), maria.dropoff.t],
      ease: true,
      frame: pair,
      maxZoom: 15.4,
      timeline: true,
      deadline: true,
      title: `${short(maria.pickup.t)}. Picked up.`,
      line: `${name} reaches ${what} at ${short(maria.dropoff.t)}, ${arrivedLate} minutes late.`,
    },
    {
      id: 'leeway',
      dur: 7,
      t: [maria.dropoff.t + 0.6, maria.dropoff.t + 1],
      frame: pair,
      maxZoom: 15.4,
      timeline: true,
      deadline: true,
      leewayCall: windowEnd,
      title: `With Leeway, the clinic knows at ${short(windowEnd)}.`,
      line: `Leeway watches the van, sees it is ${behind} minutes behind, and calls the ${dialysis ? 'dialysis center' : 'clinic'} before ${name} is late.`,
    },
    // The close: up out of the drawing into the whole simulated city, every
    // van on the road, under the Leeway card.
    {
      id: 'end',
      dur: 16,
      t: [maria.dropoff.t + 1, maria.dropoff.t + 9],
      basemap: 'full',
      fleet: true,
      pan: {
        from: { center: [-122.2712, 37.8102], zoom: 15.3, pitch: 62, bearing: 78 },
        to: { center: [-122.2655, 37.8042], zoom: 14.9, pitch: 58, bearing: 36 },
        rise: 3.5,
      },
      end: true,
    },
  ]

  // Key moments as film seconds: Maria appears, the window opens and closes,
  // the last chance passes, the pickup, the late arrival, Leeway's call.
  const starts = {}
  let clockAt = 0
  for (const sc of scenes) {
    starts[sc.id] = clockAt
    clockAt += sc.dur
  }
  const at = (id, t) => starts[id] + secondsTo(scenes.find((x) => x.id === id), t)
  scenes.bursts = [
    { at: 0.35, where: 'home', color: 'accent' },
    { at: at('opens', windowStart), where: 'home', color: 'accent' },
    { at: starts.closes + scenes.find((x) => x.id === 'closes').dur - 0.15, where: 'home', color: 'warn' },
    { at: at('missed', deadline), where: 'home', color: 'warn' },
    { at: at('missed', maria.pickup.t) - 0.05, where: 'home', color: 'warn' },
    { at: at('arrival', maria.dropoff.t) - 0.05, where: 'clinic', color: 'warn' },
    { at: starts.leeway + 0.6, where: 'home', color: 'accent' },
  ]
  return scenes
}
