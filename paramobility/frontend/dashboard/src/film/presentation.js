// The presentation (?presentation): the live story's pitch, on the ride the
// backend replays (app/demo/presentation.py). Denise waits for a van that
// comes after her window has closed, and it turns out to be shared: it
// stops for other riders nobody told her about. Once the chance of making
// her cardiology appointment drops to 50%,
// Leeway asks her, then calls the clinic (a real call, to a phone on stage)
// to say she'll be a few minutes late. It ends on what Leeway does and why.
//
// The film drives the server: it posts its clock, so the rider app on a real
// phone shows the same ride at the same moment, and the server's live model
// decides when Leeway asks. So the shots are timed from the server's timeline
// (GET /presentation/timeline, or its bundled snapshot), not hard-coded: the
// ask comes when the model says, with whatever routing the server has.
//
// Leeway has no van GPS: it only knows where the van is once she is in it,
// from her phone. So the van appears at the pickup, and from there the
// camera follows her from above.
//
// Scene fields beyond the live story's (live.js): `answerAsk` answers
// Leeway's question with yes when the shot starts (the call follows), and
// `birdsEye` follows the van from straight above ({van, zoom, bearing,
// blend, anchor}: `blend` seconds to come down onto it from the shot before;
// it keeps `anchor` in view too, pulling back from `zoom` as the van goes).

import { clock } from '../sim/fleet.js'
import { secondsTo } from './script.js'
import { makeRide } from './forecast.js'

const short = (t) => clock(t).replace(/ [AP]M$/, '')
// "11:37" as the server takes a new time (HH:MM, 24-hour).
const hhmm = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`
const azimuth = ([lng1, lat1], [lng2, lat2]) =>
  (Math.atan2((lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180), lat2 - lat1) * 180) / Math.PI
const km = (a, b) => Math.hypot((a[0] - b[0]) * 88, (a[1] - b[1]) * 111)
// "Home (Fruitvale)" → "Fruitvale"; "Dialysis Center - Oakland (synthetic)" → "Dialysis Center".
const placeName = (place) => {
  const p = place.replace(/\s*\(synthetic\)/, '')
  return p.match(/\(([^/)]+)/)?.[1]?.trim() || p.split(/ - |,/)[0].trim()
}

// What the rider app shows at time t: the model's latest answer, as it is
// (the model rounds to 5% and only changes when it hears from routing), never
// a blend of two answers it never gave.
export function sampleAt(timeline, t) {
  if (t <= timeline[0].t) return timeline[0]
  let lo = 0
  let hi = timeline.length - 1
  if (t >= timeline[hi].t) return timeline[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (timeline[mid].t <= t) lo = mid
    else hi = mid
  }
  return timeline[lo]
}

// A ride that brings its own street path (backend scripts/example_ride.py),
// in the shape makeRide gives a ride from the simulated day. The server's
// positions are (lat, lng); the map's are [lng, lat].
function rideFromPath(info) {
  const ll = ([lat, lng]) => [lng, lat]
  const times = info.path.map((q) => q[0])
  const path = info.path.map((q) => [q[2], q[1]])
  // Before the pickup and after the drop-off the van stays put. Its path starts
  // on its way to her door; the ride's route starts at her door.
  const van = { id: 'example', path, times, start: times[0], end: Infinity, behind: [] }
  const route = []
  let along = 0
  path.forEach((pos, i) => {
    if (times[i] < info.pickup_t) return
    if (route.length) along += km(route[route.length - 1].pos, pos)
    route.push({ pos, km: along, t: times[i] })
  })
  const depart = route.find((r) => r.pos[0] !== route[0].pos[0] || r.pos[1] !== route[0].pos[1])?.t ?? info.pickup_t
  const window = [short(info.window_start), short(info.window_start + 30)]
  const stops = info.stops_on_way.map((x) => ({ ...x, pos: ll(x.pos) }))
  return {
    ride: {
      van,
      pickup: { t: info.pickup_t, pos: ll(info.origin_pos), place: info.origin, window, van: van.id },
      dropoff: { t: info.dropoff_t, pos: ll(info.dest_pos), place: info.dest },
      route,
      total: along,
      depart,
    },
    stops,
  }
}

// What the rider app shows at time t once the clinic moved the appointment to
// `movedTo`: the server's timeline for that time when it's the story's
// reschedule, else null (then only the server's trip knows).
export function sampleMoved(pres, t, movedTo) {
  if (movedTo == null || !pres.timelineMoved || Math.abs(movedTo - (pres.appointment + pres.reschedule)) >= 1) return null
  return sampleAt(pres.timelineMoved, t)
}

// Everything the presentation needs about the ride, worked out once.
export function presentationRide(fleet, { info, timeline, timeline_moved: timelineMoved, online }) {
  const own = info.path?.length ? rideFromPath(info) : null
  const ride = own ? own.ride : makeRide(fleet, info.sim_trip)
  const clinicPos = ride.dropoff.pos
  // The van's other stops on the way, leaving out drop-offs at her clinic.
  const stops = (
    own
      ? own.stops
      : fleet.stops.filter((s) => s.van === ride.pickup.van && s.trip !== info.sim_trip && s.t > ride.pickup.t && s.t < ride.dropoff.t)
  )
    .filter((s) => km(s.pos, clinicPos) > 0.15)
    .map((s) => ({ ...s, label: `${s.kind === 'P' ? 'Pickup' : 'Drop-off'} · ${placeName(s.place)}` }))
  const ask = timeline.find((p) => p.ask)
  const arrivedAt = timeline.find((p) => p.phase === 'arrived')
  const clinic = info.dest.split(',')[0].replace(/ Medical Center$/, '')
  return {
    ride,
    timeline,
    online,
    info,
    name: info.rider,
    home: placeName(ride.pickup.place),
    clinic,
    town: info.dest.split(',').slice(-1)[0].trim(),
    appointment: info.appointment,
    appointmentLabel: short(info.appointment),
    windowStart: info.window_start,
    windowEnd: info.window_start + 30,
    stops,
    ask,
    // The story's reschedule (minutes later), and the chance after it.
    reschedule: info.reschedule_min || 0,
    timelineMoved: timelineMoved || null,
    // When the van gets her there (the live model's arrival), and the fix that saw it.
    arrival: arrivedAt?.eta ?? ride.dropoff.t,
    arrivedT: arrivedAt?.t ?? ride.dropoff.t,
    // The map turns so the ride runs left to right, toward the phone.
    bearing: azimuth(ride.pickup.pos, clinicPos) - 90,
  }
}

export function presentationScenes(fleet, data) {
  const pres = presentationRide(fleet, data)
  const { ride, name, ask, stops, appointment } = pres
  const pct = (p) => `${Math.round(p * 100)}%`
  const p = (t) => sampleAt(pres.timeline, t).p_on_time
  const pickupT = ride.pickup.t
  const askT = ask ? ask.t : pres.arrivedT - 6
  const lateBy = Math.round(pres.arrival - appointment)
  const minutes = ask?.ask_minutes ?? Math.max(1, lateBy)
  // Every shot of the ride frames all of it, detours too, so the camera holds
  // still while the van wanders off the line she booked.
  const route = ride.route.map((r) => r.pos)
  const whole = { frame: [ride.pickup.pos, ride.dropoff.pos, ...route], maxZoom: 14, bearing: pres.bearing }
  const T0 = pres.windowStart - 10
  const afterWindow = Math.round(pickupT - pres.windowEnd)
  // Straight down over her door until the van has her; from the pickup on,
  // her door, the hospital and the van, so the way she should go is always in
  // the picture. Turned like the whole-ride shots: it only zooms and travels.
  const close = { frame: [ride.pickup.pos], maxZoom: 15.8, bearing: pres.bearing }
  const above = {
    birdsEye: { van: ride.van, zoom: 15.8, bearing: pres.bearing, blend: 3, anchors: [ride.pickup.pos, ride.dropoff.pos] },
  }
  // When the van comes into the picture: a few minutes out (where its path starts).
  const vanFrom = Math.max(pres.windowStart, Math.min(pickupT - 1, ride.van.times[0]))
  const otherPlace = stops[0] ? stops[0].label.split(' · ')[1] : ''
  const call = {
    rider_name: name,
    clinic: pres.info.dest,
    appointment_time: clock(appointment),
    message:
      `${name}'s paratransit van is running behind, so ${name} will be about ${minutes} minutes late ` +
      `for the ${clock(appointment)} ${pres.info.title.toLowerCase()} appointment.`,
    ...(pres.reschedule
      ? {
          // The front desk can't see her that late, and offers the story's later time.
          reply: `Thanks for letting us know. We can't see ${name} that late, but we can move her to ${clock(appointment + pres.reschedule)}.`,
          close: `${clock(appointment + pres.reschedule)} works. Thank you, I'll let ${name} know. Goodbye!`,
          result: { reached_someone: true, acknowledged: true, appointment_held: false, new_time: hhmm(appointment + pres.reschedule) },
        }
      : {
          reply: `Thanks for letting us know. We'll hold ${name}'s appointment.`,
          result: { reached_someone: true, acknowledged: true, appointment_held: true },
        }),
  }

  const scenes = [
    // Why paratransit exists, and what's hard about it: words on a blank page.
    {
      id: 'paratransit',
      center: true,
      dur: 4.5,
      t: [T0, T0],
      frame: [ride.pickup.pos],
      maxZoom: 14.4,
      bearing: pres.bearing,
      jump: true,
      basemap: 'blank',
      phone: 'off',
      title: 'Paratransit.',
      line: 'Since 1990, the ADA has required transit agencies to offer door-to-door rides to people who can’t ride the bus.',
    },
    {
      id: 'scale',
      center: true,
      dur: 4,
      t: [T0, T0],
      frame: [ride.pickup.pos],
      maxZoom: 14.4,
      bearing: pres.bearing,
      phone: 'off',
      eyebrow: 'East Bay Paratransit · Jul 2025 – Apr 2026',
      title: '369,241 rides.',
      line: 'Booked by phone, one to seven days ahead.',
    },
    {
      id: 'window',
      center: true,
      dur: 4.5,
      t: [T0, T0],
      frame: [ride.pickup.pos],
      maxZoom: 14.4,
      bearing: pres.bearing,
      phone: 'off',
      title: 'A 30-minute window. No live ETA.',
      line: '1 in 19 pickups comes after the window has closed.',
    },
    // One ride, from straight above her door.
    {
      id: 'rider',
      dur: 5,
      t: [T0, T0],
      ...close,
      basemap: 'streets',
      phone: 'home',
      title: `This is ${name}.`,
      line: `${name} lives in ${pres.home}. At ${pres.appointmentLabel}: ${pres.info.title.toLowerCase()} at ${pres.clinic}.`,
    },
    {
      id: 'booked',
      dur: 6,
      t: [T0, pres.windowStart],
      ...close,
      phone: 'home',
      chart: true,
      title: 'A forecast, not a promise.',
      line: `Leeway booked her pickup window, ${short(pres.windowStart)} to ${short(pres.windowEnd)}, for a ${pct(p(pres.windowStart))} chance of making ${pres.appointmentLabel}.`,
    },
    {
      id: 'wait',
      dur: 8,
      t: [pres.windowStart, vanFrom],
      ...close,
      phone: 'home',
      chart: true,
      title: `${short(pres.windowStart)}. The window opens.`,
      line: `No van yet. Every minute ${name} waits, her chance drops.`,
    },
    {
      id: 'arrives',
      dur: 4,
      t: [vanFrom, pickupT],
      ...close,
      phone: 'home',
      chart: true,
      title: `${short(pickupT)}. The van is here.`,
      line:
        afterWindow > 0
          ? `${afterWindow} minutes after her window closed.`
          : `${Math.round(pickupT - pres.windowStart)} minutes into her window.`,
    },
    {
      id: 'pickup',
      dur: 5,
      t: [pickupT, ride.depart],
      ...above,
      phone: 'ride',
      chart: true,
      title: `Her way to ${pres.clinic}.`,
      line: 'From here, Leeway follows her phone.',
    },
    {
      id: 'detour',
      // Longer when the detour is.
      // Long enough to watch the chance fall as the van goes: about two ride minutes a second.
      dur: Math.min(14, Math.max(6, 3 + (askT - ride.depart) * 0.45)),
      t: [ride.depart, askT],
      ...above,
      phone: 'ride',
      chart: true,
      title: 'Then the van goes the other way.',
      line: otherPlace ? `Another rider to pick up, in ${otherPlace}.` : 'Another rider to pick up.',
    },
    {
      id: 'ask',
      dur: 6,
      t: [askT, askT + 0.25],
      ...above,
      phone: 'ask',
      chart: true,
      // How late Leeway expects her: what it asks about.
      title: ask ? `About ${ask.ask_minutes} minutes late.` : `Leeway asks ${name}.`,
      // She taps yes in the app.
      tap: { at: 4.6, button: 'primary' },
      line: ask
        ? `Leeway expects her around ${short(ask.eta)}, so it asks ${name}: “${ask.ask}”`
        : `It never calls anyone without ${name}’s OK.`,
    },
    {
      id: 'call',
      dur: 10,
      t: [askT + 0.25, askT + 1],
      ...above,
      phone: 'call',
      chart: true,
      answerAsk: true,
      waitForCall: true,
      title: 'She says yes. Leeway calls the clinic.',
      line: 'Live, on a real phone.',
    },
    {
      id: 'informed',
      dur: 5.5,
      t: [askT + 1, askT + 1.5],
      ...whole,
      phone: 'informed',
      chart: true,
      title: 'The clinic knows before she’s late.',
      line: `${Math.round(appointment - askT)} minutes’ notice, instead of a missed appointment.`,
      // When the clinic moved the appointment on the call (`{time}`: the new time).
      ifMoved: { title: 'Moved to {time}.', line: 'Before she’s late, not after.' },
    },
    {
      id: 'drive',
      dur: 9,
      t: [askT + 1.5, pres.arrivedT - 1],
      ease: true,
      ...whole,
      phone: 'ride',
      chart: true,
      title: 'Leeway keeps watching.',
      // Back from the call's outcome to the live trip, as she would.
      tap: { at: 0.4, button: 'Back to my ride' },
      line: 'The clinic already knows she’ll be late.',
      ifMoved: { line: 'Her chance, now for {time}.' },
    },
    {
      id: 'arrive',
      dur: 5,
      t: [pres.arrivedT - 1, pres.arrivedT + 0.5],
      ...whole,
      phone: 'arrived',
      chart: true,
      title: `${short(pres.arrival)}. Arrived.`,
      line:
        lateBy > 0
          ? `${lateBy} minute${lateBy === 1 ? '' : 's'} late, and the clinic was expecting it.`
          : 'On time, and the clinic knew she might not be.',
      ifMoved: { line: 'In time for her new appointment, {time}.', lineIfLate: 'The clinic moved her to {time}.' },
    },
    // Why it matters, and what Leeway does.
    {
      id: 'why',
      center: true,
      dur: 5.5,
      t: [pres.arrivedT + 0.5, pres.arrivedT + 0.5],
      ...whole,
      basemap: 'blank',
      phone: 'arrived',
      eyebrow: 'Why it matters',
      title: '5.8 million',
      line: 'Americans delay medical care every year because they can’t get there.',
    },
    {
      id: 'how',
      center: true,
      dur: 6.5,
      t: [pres.arrivedT + 0.5, pres.arrivedT + 0.5],
      ...whole,
      phone: 'off',
      title: 'Leeway',
      points: ['Forecasts every ride as it happens.', 'Asks the rider before it acts.', 'Calls ahead, so no one waits in the dark.'],
    },
    {
      id: 'end',
      dur: 14,
      t: [pres.arrivedT + 0.5, pres.arrivedT + 8.5],
      basemap: 'full',
      fleet: true,
      phone: 'off',
      // Over downtown Oakland, looking west across the bay toward San Francisco:
      // the way the ride's shots already face, so the camera eases round a few
      // degrees into the pan instead of swinging half a turn.
      pan: {
        from: { center: [-122.2745, 37.8040], zoom: 15.2, pitch: 62, bearing: pres.bearing - 13 },
        to: { center: [-122.2790, 37.8062], zoom: 14.7, pitch: 58, bearing: pres.bearing + 12 },
        rise: 3.5,
      },
      end: true,
    },
  ]

  // Rings at the key moments, as story seconds.
  const starts = {}
  let clockAt = 0
  for (const sc of scenes) {
    starts[sc.id] = clockAt
    clockAt += sc.dur
  }
  // The story second the clock reaches sim time t, in the ride's shots.
  const sec = (t) => {
    const sc = scenes.find((x) => x.t[1] > x.t[0] && t >= x.t[0] && t < x.t[1])
    return sc ? starts[sc.id] + secondsTo(sc, t) : null
  }
  scenes.bursts = [
    { at: starts.rider + 0.35, where: 'home', color: 'accent' },
    { at: sec(pickupT) - 0.05, where: 'home', color: 'accent' },
    // The van's other stops, as it gets to each.
    ...stops.map((s, i) => ({ at: sec(s.t), where: s.pos, color: 'ink', stop: i })).filter((b) => b.at != null),
    { at: starts.ask + 0.15, where: 'van', color: 'warn' },
    // The clinic's phone ringing.
    { at: starts.call + 0.6, where: 'clinic', color: 'accent' },
    { at: starts.call + 1.8, where: 'clinic', color: 'accent' },
    { at: starts.call + 3.0, where: 'clinic', color: 'accent' },
    { at: starts.informed + 0.3, where: 'clinic', color: 'accent' },
    { at: sec(pres.arrivedT - 0.01) ?? starts.arrive + 1, where: 'clinic', color: 'accent' },
  ]
  pres.bursts = scenes.bursts
  pres.call = call
  scenes.pres = pres
  return scenes
}
