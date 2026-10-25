// MOCK calendar provider. Stands in for the rider's phone calendar wherever
// the app can't read it (web, Expo Go, or the rider said no; see
// calendar/deviceCalendar.js): every entry, as the phone has it, work
// meetings and calls included. The backend decides with Haiku which of them
// need a ride. Entries are dated relative to now, so the live demo works
// whenever it runs: two appointments, one soon and one in two days, plus four
// that don't need a ride.
//
// The clinic's phone number is the one set in the demo panel (approved by the
// server, see backend app/voice/numbers.py), or EXPO_PUBLIC_DEMO_CLINIC_PHONE to
// start with. It's written in the clinic entries' notes, where Haiku finds it.
// Without one, trips are created with calls to the clinic turned off, so the
// demo never phones a stranger.

import { addMinutes, riderTime, toLocalISO, wallClock } from '../lib/time.js'

export const DEMO_CLINIC_PHONE = process.env.EXPO_PUBLIC_DEMO_CLINIC_PHONE || ''

export const RIDER = {
  name: 'Denise Carter',
  home: '1520 Grand Ave, Oakland',
}

const KAISER = 'Kaiser Oakland, 3600 Broadway, Oakland, CA 94611'
const DENTIST = 'Bright Smile Dental, 2001 Franklin St, Oakland, CA 94612'
const clinicNotes = (phone) => (phone ? `Questions? Call the clinic at ${phone}.` : '')

// Times are in the rider's zone (Bay Area), not the demo machine's, and fall
// in clinic hours there. The first appointment is the next half hour at least
// three hours from now; before clinic hours that's 10:30, after them it's
// 10:30 tomorrow.
function soonest() {
  const later = wallClock(Date.now() + 3 * 60 * 60 * 1000)
  const sameDay = later.day === wallClock(new Date()).day
  const slot = Math.ceil((later.hour * 60 + later.minute) / 30) * 30
  if (sameDay && slot < 10 * 60 + 30) return riderTime(0, 10, 30)
  if (sameDay && slot <= 17 * 60) return riderTime(0, Math.floor(slot / 60), slot % 60)
  return riderTime(1, 10, 30)
}

const hourLater = (start) => new Date(start.getTime() + 60 * 60 * 1000)

function entry(id, title, start, location = '', notes = '') {
  return { id, title, start: toLocalISO(start), end: toLocalISO(hourLater(start)), location, notes }
}

// The delay model has a hard floor — no paratransit service before 5 AM
// (app/prediction/prior.py SERVICE_START) — planning returns nothing at all
// for a pickup window before that. +40 minutes from a 4 AM start would land
// right in that dead zone, so push forward far enough to clear it.
function demoSoonest() {
  let start = addMinutes(new Date(), 40)
  const hour = wallClock(start).hour
  if (hour < 6) start = addMinutes(start, (6 - hour) * 60)
  return start
}

// For the judge demo (DemoPanel's "Start judge demo"): one appointment, timed
// relative to right now rather than clinic hours — judging could happen at
// any hour, so this has to work whenever it's run, not just during the day.
// Close enough that booking it, then running the ride late, fits a short
// live walkthrough.
export function demoCalendarEntries(phone) {
  return [entry('cal-demo', 'Neurology', demoSoonest(), KAISER, clinicNotes(phone))]
}

// `phone`: the number Leeway calls as the clinic.
export function calendarEntries(phone) {
  return [
    entry('cal-neuro', 'Neurology', soonest(), KAISER, clinicNotes(phone)),
    entry('cal-pt', 'Physical Therapy', riderTime(2, 14, 0), KAISER, clinicNotes(phone)),
    // A third ride-needing appointment, further out than the first two, so
    // "In the next 7 days" still has something once both of those are booked.
    entry('cal-dentist', 'Dentist', riderTime(5, 11, 0), DENTIST, clinicNotes(phone)),
    entry('cal-standup', 'Team stand-up', riderTime(1, 9, 0), 'https://zoom.us/j/84121'),
    entry('cal-mom', 'Call with Mom', riderTime(1, 18, 0)),
    entry('cal-review', 'Quarterly review', riderTime(3, 11, 0), 'Google Meet', 'meet.google.com/abc-defg-hij'),
    entry('cal-plants', 'Water the plants', riderTime(4, 8, 0), RIDER.home),
  ]
}
