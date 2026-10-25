// Date and time formatting in the rider's time zone, matching the design's
// copy ("9:15 AM", "Tue, Nov 3", "Tuesday").
//
// The rider lives in the East Bay, so every time is shown and sent in Bay Area
// time, whatever zone the phone or laptop running the demo is set to. (A demo
// run from Europe would otherwise book a "2 PM" appointment for 5 AM Pacific,
// before paratransit service starts.)

export const TIME_ZONE = 'America/Los_Angeles'

const toDate = (v) => (v instanceof Date ? v : new Date(v))

export const clock = (v) =>
  toDate(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE })

// "9:15" without AM/PM, for pickup windows like "9:15 – 9:45".
export const clockShort = (v) => clock(v).replace(/\s?[AP]M$/, '')

export const shortDate = (v) =>
  toDate(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TIME_ZONE })

export const weekday = (v) => toDate(v).toLocaleDateString('en-US', { weekday: 'long', timeZone: TIME_ZONE })

const dayKey = (v) => toDate(v).toLocaleDateString('en-CA', { timeZone: TIME_ZONE })
export const isToday = (v) => dayKey(v) === dayKey(new Date())

export const addMinutes = (v, minutes) => new Date(toDate(v).getTime() + minutes * 60000)

// The wall clock in the rider's zone: {year, month (1-12), day, hour, minute, second}.
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})
export function wallClock(v) {
  const p = Object.fromEntries(PARTS.formatToParts(toDate(v)).map(({ type, value }) => [type, Number(value)]))
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second }
}

// Minutes the rider's zone is ahead of UTC at that moment (-420 in PDT).
function offsetMinutes(v) {
  const w = wallClock(v)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return Math.round((asUtc - Math.floor(toDate(v).getTime() / 1000) * 1000) / 60000)
}

// The moment it is `hours:minutes` in the rider's zone, `daysFromToday` days
// from today there.
export function riderTime(daysFromToday, hours, minutes = 0) {
  const today = wallClock(new Date())
  const wall = Date.UTC(today.year, today.month - 1, today.day + daysFromToday, hours, minutes)
  let t = wall - offsetMinutes(wall) * 60000
  t = wall - offsetMinutes(t) * 60000 // settles across a daylight-saving change
  return new Date(t)
}

// ISO 8601 with the rider's UTC offset (not "Z"), so the backend formats
// times in the rider's time zone when it talks about them.
export function toLocalISO(v) {
  const w = wallClock(v)
  const offset = offsetMinutes(v)
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return (
    `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}` +
    `${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`
  )
}

export const percent = (p) => `${Math.round(p * 100)}%`
