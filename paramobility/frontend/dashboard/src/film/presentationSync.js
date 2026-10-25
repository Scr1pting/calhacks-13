// The presentation ride's link to the server (backend app/demo/presentation.py):
// the ride and its timeline, starting the ride, posting the film's clock so the
// rider app on a real phone follows along, and answering Leeway's question.
//
// Set up once per browser, like the live story (liveCall.js):
//   #key=<API key>&phone=<+1 number Leeway calls>&rider=<the phone's rider id>
// With a key but no rider, it follows the ride the phone's demo panel started.
// Without a key it plays offline from public/data/presentation.json (made by
// backend scripts/presentation_snapshot.py), with a scripted call.

import { config, liveCall } from './liveCall.js'

const API = import.meta.env.VITE_API_BASE || 'https://api.cal.fuzz.li'

// `trip`: the server's trip, followed once the rider said yes (a call can move the appointment).
const run = { online: false, tripId: null, pending: null, error: '', following: false, trip: null }

// Minutes after midnight in the rider's zone, for an ISO time.
const ZONE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric' })
const minutesOf = (iso) => {
  const p = Object.fromEntries(ZONE.formatToParts(new Date(iso)).map((x) => [x.type, Number(x.value)]))
  return p.hour * 60 + p.minute
}
let flight = null // the clock post on its way, if any

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': config().key },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`)
  return res.json()
}

// Whether a real phone plays the rider's phone (paired in the setup panel),
// instead of the film's virtual one. Pairing needs the server.
export const isPaired = () => {
  const c = config()
  return Boolean(c.paired && c.rider && c.key)
}

// The setup panel's calls.
export const setup = {
  // The key works (and the server has the presentation ride).
  check: () => api('GET', '/presentation'),
  // Whether Leeway may call this number; with the server's PIN, approve it.
  async approve(phone, pin) {
    let status = await api('POST', '/call-numbers/check', { phone })
    if (!status.approved && pin && status.phone.startsWith('+')) {
      status = await api('POST', '/call-numbers', { phone, pin })
    }
    return status
  },
  // A six-digit code a phone trades for this rider and the key (POST /pairing).
  pairCode: (riderId) => api('POST', '/pairing', { rider_id: riderId }),
  // A paired phone has opened the app: its rider exists on the server.
  async riderExists(id) {
    try {
      await api('GET', `/riders/${encodeURIComponent(id)}`)
      return true
    } catch {
      return false
    }
  },
}

// {info, timeline, online}: from the server when this browser is set up,
// else the bundled snapshot.
export async function loadPresentation() {
  if (config().key) {
    try {
      const [info, timeline] = await Promise.all([api('GET', '/presentation'), api('GET', '/presentation/timeline')])
      // The chance once the clinic has moved the appointment (the story's reschedule).
      const moved = info.reschedule_min ? await api('GET', `/presentation/timeline?moved=${info.reschedule_min}`) : null
      return { info, timeline, timeline_moved: moved, online: true }
    } catch (e) {
      run.error = e.message
    }
  }
  const res = await fetch('/data/presentation.json')
  const { info, timeline, timeline_moved: moved } = await res.json()
  return { info, timeline, timeline_moved: moved, online: false }
}

// One clock post at a time; the next one carries the latest time.
function pump() {
  if (run.pending == null) {
    flight = null
    return
  }
  const t = run.pending
  run.pending = null
  flight = api('POST', '/presentation/clock', { t })
    .then(() => (run.following ? api('GET', `/trips/${run.tripId}`).then((trip) => (run.trip = trip)) : null))
    .catch((e) => {
      run.error = e.message
    })
    .then(pump)
}

export const presentationSync = {
  get: () => ({ ...run }),
  // The new appointment, in minutes after midnight, once a call moved it; else null.
  // From the server's trip, or, without one, from the call's result (the scripted call too).
  movedTo(appointment) {
    let m = run.trip ? minutesOf(run.trip.arrive_by) : null
    const said = /^(\d{1,2}):(\d{2})$/.exec(liveCall.get().result?.new_time || '')
    if (m == null && said) m = Number(said[1]) * 60 + Number(said[2])
    return m != null && Math.abs(m - appointment) >= 1 ? m : null
  },

  // The trip the film drives: a fresh one (a whole call budget each run) for
  // the configured rider, or the one the phone started. Offline, none.
  async start({ online, info }) {
    run.online = online
    run.tripId = null
    run.pending = null
    run.following = false
    run.trip = null
    if (!online) return
    const { rider, phone } = config()
    if (!rider && info.trip_id) {
      run.tripId = info.trip_id
      return
    }
    try {
      const trip = await api('POST', '/presentation/start', { rider_id: rider || 'rider_presentation', appointment_phone: phone })
      run.tripId = trip.id
    } catch (e) {
      run.error = e.message
      run.online = false
    }
  },

  post(t) {
    if (!run.online || !run.tripId) return
    run.pending = t
    if (!flight) pump()
  },

  // The rider said yes: once the server's clock has reached the ask, it places
  // the late-notice call; follow it. Without a backend or a number to call,
  // the scripted call plays.
  async answer(call) {
    if (!run.online || !run.tripId || !config().phone) {
      liveCall.watch(null, call)
      return
    }
    while (flight) await flight
    run.following = true
    try {
      await api('POST', `/trips/${run.tripId}/late-ask`, { call: true })
    } catch (e) {
      run.error = e.message // answered on the phone already, say: the call is still on
    }
    liveCall.watch(run.tripId, call)
  },
}
