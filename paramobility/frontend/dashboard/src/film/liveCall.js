// The live story's real phone call. When the story reaches "Leeway calls the
// clinic", the backend dials a phone on stage (POST /demo/calls, to a number
// the server has approved) and this follows the call's transcript as it
// happens, over the trip's event stream.
//
// Set it up once per browser with a URL fragment (it never reaches a server):
//   #key=<the API key>&phone=<+1 number to call>
// Without them, or if the call can't be placed, the story plays a scripted
// call instead, labelled as a rehearsal, so it never stalls.

const API = import.meta.env.VITE_API_BASE || 'https://api.cal.fuzz.li'
const STORE = 'leeway.live'

// Also `rider=<rider id>` for the presentation ride (presentationSync.js), and
// what the presentation's setup panel saves: the rider app's address for
// pairing a phone (`riderUrl`) and whether a phone is paired (`paired`).
export function config() {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  let saved = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORE) || '{}')
  } catch {
    // private mode: use the fragment only
  }
  const next = {
    ...saved,
    key: hash.get('key') || saved.key || '',
    phone: hash.get('phone') || saved.phone || '',
    rider: hash.get('rider') || saved.rider || '',
  }
  if (hash.get('key') || hash.get('phone') || hash.get('rider')) {
    store(next)
    // Keep the key out of the address bar on screen.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return next
}

// Change and keep some of it (the setup panel). The dashboard reloads the
// presentation's data when it hears 'leeway-setup'.
export function saveConfig(change) {
  const next = { ...config(), ...change }
  store(next)
  window.dispatchEvent(new Event('leeway-setup'))
  return next
}

function store(value) {
  try {
    localStorage.setItem(STORE, JSON.stringify(value))
  } catch {
    // not saved: set up again next time
  }
}

// status: idle | dialing | ringing | talking | done | failed
const state = { status: 'idle', lines: [], result: null, error: '', rehearsal: false, startedAt: 0 }
const listeners = new Set()
let close = () => {}
let timers = []

function set(change) {
  Object.assign(state, change)
  for (const l of listeners) l({ ...state, lines: [...state.lines] })
}

export const liveCall = {
  get: () => ({ ...state, lines: [...state.lines] }),
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  // Finished one way or another: the story may move on.
  isOver: () => state.status === 'done' || state.status === 'failed',
  hasSetup: () => Boolean(config().key && config().phone),

  reset() {
    close()
    timers.forEach(clearTimeout)
    timers = []
    set({ status: 'idle', lines: [], result: null, error: '', rehearsal: false, startedAt: 0 })
  },

  async start(call) {
    if (state.status !== 'idle') return
    const { key, phone } = config()
    set({ status: 'dialing', startedAt: performance.now() })
    if (!key || !phone) return rehearse(call, 'No phone set up for this browser')
    try {
      const res = await fetch(`${API}/demo/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({ phone, ...call }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`)
      follow((await res.json()).trip_id, key)
    } catch (e) {
      rehearse(call, e.message)
    }
  },

  // Follow a call something else placed on a trip (the presentation's late
  // notice, once the rider says yes). Offline, or if the call doesn't go
  // through, the scripted call plays, so the story still has its call.
  watch(tripId, call) {
    if (state.status !== 'idle') return
    const { key } = config()
    set({ status: 'dialing', startedAt: performance.now() })
    if (!key || !tripId) return rehearse(call, 'No backend set up for this browser')
    // Calls from earlier runs on the same trip are not this one (a minute's slack for clocks).
    const since = Date.now() - 60_000
    follow(tripId, key, (why) => {
      set({ status: 'dialing', lines: [] })
      rehearse(call, why)
    }, since)
  },
}

// Follow a call's events: live over the stream, plus whatever was logged
// before the stream connected. `onFail(why)`, if given, takes over a call
// that fails; otherwise the call shows as failed. Events before `since` (ms)
// are skipped.
function follow(tripId, key, onFail, since = 0) {
  const seen = new Set()
  const handle = (ev) => {
    if (seen.has(ev.id) || Date.parse(ev.at) < since) return
    seen.add(ev.id)
    const d = ev.data || {}
    if (ev.kind === 'call_started') set({ status: 'ringing' })
    if (ev.kind === 'call_progress') set({ status: 'talking', lines: [...state.lines, ...(d.lines || [])] })
    if (ev.kind === 'call_ended') {
      set({ status: 'done', lines: d.transcript?.length ? d.transcript : state.lines, result: d.result || null })
      close()
    }
    if (ev.kind === 'call_blocked' || ev.kind === 'call_failed' || ev.kind === 'call_skipped') {
      close()
      if (onFail) onFail(ev.message)
      else set({ status: 'failed', error: ev.message })
    }
  }
  const es = new EventSource(`${API}/trips/${tripId}/stream?api_key=${encodeURIComponent(key)}`)
  es.addEventListener('events', (e) => handle(JSON.parse(e.data)))
  es.onopen = () =>
    fetch(`${API}/trips/${tripId}/events`, { headers: { 'X-API-Key': key } })
      .then((r) => r.json())
      .then((list) => list.forEach(handle))
      .catch(() => {})
  close = () => es.close()
}

// The scripted call: same shape, fixed lines, paced like a real one. `call.reply`
// and `call.result` set the clinic's answer (default: it moves the appointment).
function rehearse(call, why) {
  set({ rehearsal: true, error: why })
  const lines = [
    ['agent', `Hi, this is an automated assistant calling on behalf of ${call.rider_name} about the ${call.appointment_time} appointment.`],
    ['callee', 'Hi, yes, go ahead.'],
    ['agent', call.message],
    ['callee', call.reply ?? `Sure, we can move ${call.rider_name} to ${call.new_time}.`],
    ['agent', `Thank you, I'll let ${call.rider_name} know. Goodbye!`],
  ]
  let at = 1800
  timers.push(setTimeout(() => set({ status: 'ringing' }), 300))
  lines.forEach(([role, text], i) => {
    at += i === 0 ? 0 : 900 + text.length * 22
    timers.push(setTimeout(() => set({ status: 'talking', lines: [...state.lines, { role, text }] }), at))
  })
  timers.push(
    setTimeout(
      () => set({ status: 'done', result: call.result ?? { delivered: true, response: `Moved to ${call.new_time}.` } }),
      at + 1400,
    ),
  )
}
