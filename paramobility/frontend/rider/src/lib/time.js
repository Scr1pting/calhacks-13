// Date and time formatting in the rider's local time zone, matching the
// design's copy ("9:15 AM", "Tue, Nov 3", "Tuesday").

const toDate = (v) => (v instanceof Date ? v : new Date(v))

export const clock = (v) =>
  toDate(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// "9:15" without AM/PM, for pickup windows like "9:15 – 9:45".
export const clockShort = (v) => clock(v).replace(/\s?[AP]M$/, '')

export const shortDate = (v) =>
  toDate(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export const weekday = (v) => toDate(v).toLocaleDateString('en-US', { weekday: 'long' })

export const isToday = (v) => toDate(v).toDateString() === new Date().toDateString()

export const addMinutes = (v, minutes) => new Date(toDate(v).getTime() + minutes * 60000)

// ISO 8601 with the local UTC offset (not "Z"), so the backend formats times
// in the rider's time zone when it talks about them.
export function toLocalISO(v) {
  const d = toDate(v)
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`
  )
}

// Odds from the model, kept within 1-99%: a forecast is never certain.
export const percent = (p) => `${Math.min(Math.max(Math.round(p * 100), 1), 99)}%`
