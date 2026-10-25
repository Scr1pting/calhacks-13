// MOCK calendar provider. Stands in for reading the rider's real calendar
// until a calendar API is connected. Appointments are dated relative to now,
// so the live demo works whenever it runs: one later today, one in two days.
//
// The clinic's phone number comes from VITE_DEMO_CLINIC_PHONE (a phone you
// can answer). Without it, trips are created with calls to the clinic turned
// off, so the demo never phones a stranger.

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

function at(daysFromToday, hours, minutes) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  d.setHours(hours, minutes, 0, 0)
  return d
}

// The next half hour, at least three hours from now, for today's appointment.
function laterToday() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0)
  return d
}

export function upcomingAppointments() {
  return [
    { id: 'cal-neuro', title: 'Neurology', start: laterToday(), location: KAISER },
    { id: 'cal-pt', title: 'Physical Therapy', start: at(2, 14, 0), location: KAISER },
  ]
}

// How many calendar events were left out because they don't look like they
// need a ride (work meetings, calls). Shown on the discovery screen.
export const SKIPPED_EVENTS = 4
