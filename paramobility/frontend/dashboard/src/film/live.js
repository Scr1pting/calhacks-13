// The live story (?live): the pitch with a real phone in it. Why paratransit
// exists and what's hard about it, then one ride: Maria is picked up on time,
// a traffic incident puts her van on track to be late, Leeway asks her, then
// calls the clinic (a real call, to a phone on stage) and moves the
// appointment 30 minutes. It ends on what Leeway does and why it matters.
//
// The ride is a real one from the simulated day (trip D15T0324): its route,
// timing and the incident are the simulator's. The appointment is set from
// the van's plan: due 20 minutes after the planned arrival, so on a normal
// day Maria is early. The forecast (forecast.js) only knows what Leeway could
// have known at each moment.
//
// Scene fields beyond the story's (story.js): `phone` is the screen Maria's
// phone shows, `chart` shows the forecast chart, `center` puts the words in
// the middle of the page, `waitForCall` holds the shot until the real call
// has ended, and `startCall` places it.

import { clock } from '../sim/fleet.js'
import { secondsTo } from './script.js'
import { forecast, makeRide } from './forecast.js'

const TRIP = 'D15T0324'
const short = (t) => clock(t).replace(/ [AP]M$/, '')
const area = (place) => place.match(/\(([^/)]+)/)?.[1]?.trim() || place.split(',')[0]
const azimuth = ([lng1, lat1], [lng2, lat2]) =>
  (Math.atan2((lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180), lat2 - lat1) * 180) / Math.PI

// Everything the live story needs about the ride, worked out once.
export function liveRide(fleet) {
  const ride = makeRide(fleet, TRIP)
  const appointment = Math.round((ride.plannedDrop + 20) / 5) * 5
  const newAppointment = appointment + 30
  // Leeway acts the minute the forecast says she more likely than not is late.
  let alarm = ride.depart
  while (alarm < ride.dropoff.t && forecast(ride, alarm, appointment).pOnTime >= 0.5) alarm += 0.25
  const clinic = ride.dropoff.place
  return {
    ride,
    name: 'Maria',
    home: area(ride.pickup.place),
    clinic,
    clinicShort: clinic.split(/[,(]/)[0].replace(/ Center$| Medical Center$/, ' Medical').trim(),
    appointment,
    newAppointment,
    appointmentLabel: short(appointment),
    newAppointmentLabel: short(newAppointment),
    alarm,
    // The map turns so the ride runs left to right, toward the phone.
    bearing: azimuth(ride.pickup.pos, ride.dropoff.pos) - 90,
  }
}

export function liveScenes(fleet) {
  const live = liveRide(fleet)
  const { ride, name, alarm } = live
  const at = (t, by = live.appointment) => forecast(ride, t, by)
  const pct = (p) => `${Math.round(p * 100)}%`
  const crawlKm = at(alarm).done
  const crawlMin = Math.round(alarm - ride.depart)
  const route = ride.route.map((r) => r.pos)
  const whole = { frame: [ride.pickup.pos, ride.dropoff.pos, ...route], maxZoom: 14, bearing: live.bearing }
  const T0 = ride.pickup.t - 30
  const call = {
    rider_name: name,
    clinic: live.clinic,
    appointment_time: clock(live.appointment),
    new_time: clock(live.newAppointment),
    message:
      `${name}'s paratransit van is stuck in traffic, so ${name} will likely be late for the ` +
      `${clock(live.appointment)} appointment. Could you move it 30 minutes later, to ${clock(live.newAppointment)}?`,
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
      bearing: live.bearing,
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
      bearing: live.bearing,
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
      bearing: live.bearing,
      phone: 'off',
      title: 'A 30-minute window with no live ETA.',
      line: '1 in 19 pickups comes after the window has closed.',
    },
    // One ride.
    {
      id: 'maria',
      dur: 5,
      t: [T0, T0],
      frame: [ride.pickup.pos],
      maxZoom: 14.4,
      bearing: live.bearing,
      phone: 'home',
      title: `This is ${name}.`,
      line: `${name} lives in ${live.home}. At ${live.appointmentLabel}: an appointment at ${live.clinic.replace(/, /, ' in ')}.`,
    },
    {
      id: 'route',
      dur: 5.5,
      t: [T0, ride.pickup.t - 8],
      ...whole,
      basemap: 'streets',
      phone: 'home',
      title: `${Math.round(ride.total)} km in a shared van.`,
      line: `Planned to arrive at ${short(ride.plannedDrop)}, ${Math.round(live.appointment - ride.plannedDrop)} minutes early.`,
    },
    {
      id: 'pickup',
      dur: 4.5,
      t: [ride.pickup.t - 8, ride.pickup.t],
      ease: true,
      ...whole,
      phone: 'arriving',
      title: `${short(ride.pickup.t)}. Picked up on time.`,
      line: 'From here, Leeway follows the van.',
    },
    {
      id: 'forecast',
      dur: 7,
      t: [ride.depart, ride.depart + 3],
      ...whole,
      phone: 'ride',
      chart: true,
      title: 'A forecast, not a promise.',
      line: `Every dot is one way the next hour could go. ${pct(at(ride.depart).pOnTime)} reach the clinic by ${live.appointmentLabel}.`,
    },
    {
      id: 'setback',
      dur: 7,
      t: [ride.depart + 3, alarm],
      ease: true,
      ...whole,
      phone: 'ride',
      chart: true,
      title: 'Then, a traffic incident.',
      line: `The van crawls ${crawlKm.toFixed(1)} km in ${crawlMin} minutes. By ${short(alarm)}, only ${pct(at(alarm).pOnTime)} of the dots make it.`,
    },
    {
      id: 'ask',
      dur: 6,
      t: [alarm, alarm + 0.5],
      ...whole,
      phone: 'ask',
      chart: true,
      title: `Leeway asks ${name} first.`,
      line: `It never calls anyone without ${name}’s OK.`,
    },
    {
      id: 'call',
      dur: 10,
      t: [alarm + 0.5, alarm + 2],
      ...whole,
      phone: 'call',
      chart: true,
      startCall: call,
      waitForCall: true,
      title: 'Then it calls the clinic.',
      line: 'Live, on a real phone.',
    },
    {
      id: 'moved',
      dur: 5.5,
      t: [alarm + 2, alarm + 2.5],
      ...whole,
      phone: 'moved',
      chart: true,
      title: `Moved to ${live.newAppointmentLabel}.`,
      line: `Before ${name} is late, not after. ${pct(at(alarm + 2.5, live.newAppointment).pOnTime)} of the dots now make it.`,
    },
    {
      id: 'drive',
      dur: 8,
      t: [alarm + 2.5, ride.dropoff.t - 1],
      ease: true,
      ...whole,
      phone: 'ride',
      chart: true,
      title: 'Leeway keeps watching.',
      line: 'The forecast tightens as the van gets closer.',
    },
    {
      id: 'arrive',
      dur: 4.5,
      t: [ride.dropoff.t - 1, ride.dropoff.t + 0.5],
      ...whole,
      phone: 'ride',
      chart: true,
      title: `${short(ride.dropoff.t)}. Arrived.`,
      line: `${Math.round(live.newAppointment - ride.dropoff.t)} minutes before the new appointment.`,
    },
    // Why it matters, and what Leeway does.
    {
      id: 'why',
      center: true,
      dur: 5.5,
      t: [ride.dropoff.t, ride.dropoff.t],
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
      t: [ride.dropoff.t, ride.dropoff.t],
      ...whole,
      phone: 'off',
      title: 'Leeway',
      points: ['Forecasts every ride as it happens.', 'Asks the rider before it acts.', 'Calls ahead to make room.'],
    },
    {
      id: 'end',
      dur: 14,
      t: [ride.dropoff.t, ride.dropoff.t + 8],
      basemap: 'full',
      fleet: true,
      phone: 'off',
      pan: {
        from: { center: [-122.2712, 37.8102], zoom: 15.3, pitch: 62, bearing: 78 },
        to: { center: [-122.2655, 37.8042], zoom: 14.9, pitch: 58, bearing: 36 },
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
  const sec = (id, t) => starts[id] + secondsTo(scenes.find((x) => x.id === id), t)
  scenes.bursts = [
    { at: starts.maria + 0.35, where: 'home', color: 'accent' },
    { at: sec('pickup', ride.pickup.t) - 0.05, where: 'home', color: 'accent' },
    { at: starts.ask + 0.15, where: 'van', color: 'warn' },
    // The clinic's phone ringing.
    { at: starts.call + 0.6, where: 'clinic', color: 'accent' },
    { at: starts.call + 1.8, where: 'clinic', color: 'accent' },
    { at: starts.call + 3.0, where: 'clinic', color: 'accent' },
    { at: starts.moved + 0.3, where: 'clinic', color: 'accent' },
    { at: sec('arrive', ride.dropoff.t), where: 'clinic', color: 'accent' },
  ]
  live.bursts = scenes.bursts
  scenes.live = live
  return scenes
}
