// The rider app's API client (rider/src/api/client.js), as the presentation
// film's phone sees it. The film's phone is the real rider app: its own
// useLeewayFlow hook picks the screen and words every view. Only the server
// is stood in for: this answers the app's calls with the presentation trip
// as the server has it at the film's moment (the backend's timeline), and
// streams the trip's changes and the late-notice call's events the way the
// server would. Answering Leeway's question places the call (the real one
// when this browser is set up, see presentationSync.js).
//
// vite.config.js points the rider app's '../api/client.js' import here.

import { vanState } from '../sim/fleet.js'
import { riderTime, toLocalISO } from '../../../rider/src/lib/time.js'
import { liveCall } from './liveCall.js'
import { sampleAt } from './presentation.js'
import { presentationSync } from './presentationSync.js'

export const API_BASE = 'presentation film'
export class ApiError extends Error {}

const TRIP_ID = 'trip_presentation'
const film = { pres: null, t: 0, answered: false, events: [], sent: '', call: { started: false, lines: 0, ended: false } }
const tripListeners = new Set()
const eventListeners = new Set()

// Sim minutes as an ISO time today, in the rider's time zone.
const iso = (minutes) => toLocalISO(new Date(riderTime(0, 0, 0).getTime() + minutes * 60000))
const latLng = ([lng, lat]) => [lat, lng]

// The server's trip once a call moved its appointment (online only), else null.
function moved() {
  const pres = film.pres
  if (!pres || presentationSync.movedTo(pres.appointment) == null) return null
  return presentationSync.get().trip
}

// The trip as the server would have it at the film's clock.
function trip() {
  const { pres, t } = film
  const { info, ride } = pres
  const s = sampleAt(pres.timeline, t)
  const status = s.phase === 'onboard' ? 'riding' : s.phase === 'arrived' ? 'completed' : 'booked'
  const aboard = status !== 'booked'
  const asked = pres.ask && t >= pres.ask.t
  const van = aboard ? vanState(ride.van, t) : null
  return {
    id: TRIP_ID,
    demo: 'presentation',
    created_at: iso(info.start),
    rider: { name: info.rider, phone: '' },
    appointment: { name: info.appointment_name, phone: '' },
    title: info.title,
    rider_id: 'rider_presentation',
    calendar_event_id: '',
    origin: info.origin,
    dest: info.dest,
    arrive_by: iso(info.appointment),
    certainty: 0.9,
    permissions: { may_call_appointment: true, share_rider_name: true, max_calls: 3 },
    status,
    policy: null,
    plan: null,
    booked_pickup: iso(info.window_start),
    calls_used: film.answered ? 1 : 0,
    outlook: { checked_at: iso(t), p_on_time: s.p_on_time, expected_arrival: iso(s.eta), minutes_late: s.minutes_late },
    live: {
      van_eta: null,
      picked_up_at: aboard ? iso(info.pickup_t) : null,
      arrived_at: status === 'completed' ? iso(pres.arrival) : null,
      progress: aboard ? s.progress : null,
      position: van ? latLng(van.pos) : null,
      origin: latLng(ride.pickup.pos),
      destination: latLng(ride.dropoff.pos),
    },
    late_ask: asked
      ? { asked_at: iso(pres.ask.t), minutes_late: pres.ask.ask_minutes, message: pres.ask.ask, answer: film.answered ? 'call' : null }
      : null,
    late_notice: film.call.ended ? { sent_at: iso(t), minutes_late: pres.ask?.ask_minutes ?? 5 } : null,
    // After a move the server's appointment and chance (the timeline was for the old time).
    ...(moved() && { arrive_by: moved().arrive_by, outlook: moved().outlook ?? null }),
  }
}

function emitTrip() {
  // Nobody listening yet (the app is loading): it catches up when it subscribes.
  if (!film.pres || !tripListeners.size) return
  // A call moved the appointment: say so, as the server does.
  const server = moved()
  if (server && !film.movedSent) {
    film.movedSent = true
    emitEvent('appointment_moved', `Appointment moved to ${server.arrive_by}.`)
  }
  const now = trip()
  const key = JSON.stringify({ ...now, outlook: { ...now.outlook, checked_at: 0 } })
  if (key === film.sent) return
  film.sent = key
  for (const l of tripListeners) l(now)
}

function emitEvent(kind, message, data = {}) {
  const ev = { id: `evt_film_${film.events.length}`, trip_id: TRIP_ID, at: new Date().toISOString(), kind, message, data }
  film.events.push(ev)
  for (const l of eventListeners) l(ev)
}

// The late-notice call, as the server logs it: started, lines as they come, ended.
liveCall.subscribe((c) => {
  if (!film.pres || !film.answered) return
  const kind = { call_kind: 'late_notice' }
  if (!film.call.started && ['ringing', 'talking', 'done'].includes(c.status)) {
    film.call.started = true
    emitEvent('call_started', `Calling ${film.pres.info.appointment_name}.`, kind)
  }
  if (c.lines.length > film.call.lines) {
    emitEvent('call_progress', 'Call in progress.', { ...kind, lines: c.lines.slice(film.call.lines) })
    film.call.lines = c.lines.length
  }
  if (!film.call.ended && c.status === 'done') {
    film.call.ended = true
    emitEvent('call_ended', `Call with ${film.pres.info.appointment_name} ended.`, { ...kind, result: c.result, transcript: c.lines })
    emitTrip()
  }
})

export const filmRider = {
  // A fresh ride at the film's clock t (the film starts, or goes back in time).
  reset(pres, t) {
    // Starting past the question (a presenter skipping ahead): she has said yes already.
    const answered = !!pres.ask && t > pres.ask.t + 0.5
    Object.assign(film, { pres, t, answered, events: [], sent: '', movedSent: false, call: { started: false, lines: 0, ended: false } })
  },
  // The film's clock moved: the server's trip moves with it.
  tick(t) {
    film.t = t
    emitTrip()
  },
  // Yes to Leeway's question, from the app's button or the film moving past it.
  answer() {
    if (!film.pres || film.answered) return
    film.answered = true
    emitEvent('late_ask_answered', 'Rider asked Leeway to call.')
    emitTrip()
    presentationSync.answer(film.pres.call)
  },
}

const ok = (v) => Promise.resolve(v)

export const api = {
  getTrip: () => ok(trip()),
  events: () => ok([...film.events]),
  answerLateAsk: (id, call) => {
    if (call) filmRider.answer()
    return ok(trip())
  },
  putRider: (id, profile) => ok({ id, ...profile }),
  syncCalendar: () => ok({ calendar: [], skipped: 0 }),
  riderTrips: () => ok(film.pres ? [trip()] : []),
  riderMessages: () => ok([]),
  checkCallNumber: (phone) => ok({ phone, approved: true, reason: '' }),
  // Nothing else happens in the film; the app never gets here.
  createTrip: () => Promise.reject(new ApiError('not in the film')),
  messages: () => ok([]),
  sendMessage: () => ok([]),
  replan: () => ok(trip()),
  book: () => ok(trip()),
  status: () => ok(trip()),
  addCallNumber: (phone) => ok({ phone, approved: true, reason: '' }),
  sendRiderMessage: () => ok([]),
  sendVoice: () => ok({ transcript: '', messages: [] }),
  speech: () => ok(new Blob()),
}

export function streamTrip(id, { onEvent }) {
  eventListeners.add(onEvent)
  return () => eventListeners.delete(onEvent)
}

export function streamRider(id, { onTrip }) {
  tripListeners.add(onTrip)
  // What a fresh stream would catch up on: the trip as it is now (the app may
  // have loaded it a moment ago, before the film's clock moved).
  if (film.pres) queueMicrotask(() => onTrip(trip()))
  return () => tripListeners.delete(onTrip)
}
