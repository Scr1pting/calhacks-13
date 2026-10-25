// MOCK calendar provider. Stands in for reading the rider's real calendar
// until a calendar API is connected. Appointments are dated relative to now,
// so the live demo works whenever it runs: one soon, one in two days.
//
// The clinic's phone number comes from VITE_DEMO_CLINIC_PHONE (a phone you
// can answer). Without it, trips are created with calls to the clinic turned
// off, so the demo never phones a stranger.

import { riderTime, wallClock } from '../lib/time.js'

export const DEMO_CLINIC_PHONE = import.meta.env.VITE_DEMO_CLINIC_PHONE || ''

export const RIDER = {
  name: 'Denise Carter',
  home: '1520 Grand Ave, Oakland',
}

const KAISER = {
  name: 'Kaiser Oakland',
  address: '3600 Broadway, Oakland',
  phone: DEMO_CLINIC_PHONE,
}

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

export function upcomingAppointments() {
  return [
    { id: 'cal-neuro', title: 'Neurology', start: soonest(), location: KAISER },
    { id: 'cal-pt', title: 'Physical Therapy', start: riderTime(2, 14, 0), location: KAISER },
  ]
}

// How many calendar events were left out because they don't look like they
// need a ride (work meetings, calls). Shown on the discovery screen.
export const SKIPPED_EVENTS = 4
