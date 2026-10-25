// An in-memory Paramobility backend for the UI tests. It replaces `fetch` and
// `EventSource`, keeps trips, events and the rider's conversation, and checks
// every request (route, method, API key, body) and every JSON response against
// the real backend's OpenAPI spec. Anything off is collected in `violations`,
// which the tests assert is empty.
//
// Tests drive the backend side of the story with the helpers at the bottom:
// finishing a plan, a late-notice call starting and ending, and so on.

import { findRoute, requestSchema, responseSchema, validate } from './openapi.js'

export const API_BASE = 'http://api.test'
export const API_KEY = 'test-key'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// `streamConnectMs`: how long a new stream takes to connect, like a real
// EventSource's round trip. Events logged meanwhile never reach it, as with the
// real backend, which doesn't replay past events. Streams always connect
// asynchronously and fire `open`, or `error` when the backend answers 404
// (unknown trip or rider), after which a real EventSource gives up for good.
export function createFakeBackend({ streamConnectMs = 0 } = {}) {
  const state = { riders: {}, trips: {}, events: {}, threads: {} }
  const requests = [] // "METHOD /path" in order
  const bodies = [] // {call, body}
  const violations = []
  const streams = new Set()
  const failures = [] // {call, status, detail}: the next matching request fails
  const hooks = {} // tripCreated(id)
  let seq = 0
  const id = (prefix) => `${prefix}${++seq}`
  const now = () => new Date().toISOString()

  // ---- streams --------------------------------------------------------------

  class FakeEventSource {
    constructor(url) {
      const u = new URL(url)
      this.path = u.pathname
      this.listeners = {}
      this.closed = false
      if (u.searchParams.get('api_key') !== API_KEY) violations.push(`stream ${this.path}: missing or wrong api_key`)
      if (!findRoute('GET', this.path)) violations.push(`stream ${this.path}: no such route in the backend`)
      // Checked when the stream is opened: the request may reach the backend
      // before an earlier request that creates the rider or trip.
      const [, table, key] = this.path.split('/')
      this.missing = !(table === 'riders' ? state.riders : state.trips)[key]
      this.table = table
      setTimeout(() => this.connect(), streamConnectMs)
    }
    connect() {
      if (this.closed) return
      const table = this.table
      if (this.missing) {
        violations.push(`stream ${this.path}: 404, opened before the backend knew this ${table.slice(0, -1)}`)
        this.closed = true
        return (this.listeners.error || []).forEach((fn) => fn({}))
      }
      streams.add(this)
      ;(this.listeners.open || []).forEach((fn) => fn({}))
    }
    addEventListener(event, fn) {
      ;(this.listeners[event] ||= []).push(fn)
    }
    close() {
      this.closed = true
      streams.delete(this)
    }
  }

  function emit(path, event, data) {
    for (const es of streams) {
      if (es.path === path && !es.closed) (es.listeners[event] || []).forEach((fn) => fn({ data: JSON.stringify(data) }))
    }
  }

  // ---- state helpers ----------------------------------------------------------

  function log(tripId, kind, message, data = {}) {
    const ev = { id: id('e'), trip_id: tripId, at: now(), kind, message, data }
    ;(state.events[tripId] ||= []).push(ev)
    emit(`/trips/${tripId}/stream`, 'events', ev)
    return ev
  }

  function post(threadId, sender, text, kind = 'reply') {
    const msg = { id: id('m'), thread_id: threadId, at: now(), sender, kind, text }
    ;(state.threads[threadId] ||= []).push(msg)
    emit(`/riders/${threadId}/stream`, 'messages', msg)
    return msg
  }

  const trip = (tripId) => state.trips[tripId]
  const update = (tripId, change) => Object.assign(state.trips[tripId], change)

  // ---- routes -----------------------------------------------------------------

  const routes = [
    ['PUT', /^\/riders\/([^/]+)$/, ([rid], body) => (state.riders[rid] = { calendar: state.riders[rid]?.calendar || [], id: rid, ...body, updated_at: now() })],
    // Stands in for Haiku: entries at a clinic need a ride, the rest are skipped.
    ['PUT', /^\/riders\/([^/]+)\/calendar$/, ([rid], { entries }) => {
      const calendar = entries
        .filter((e) => /kaiser/i.test(e.location) && new Date(e.start) > Date.now())
        .map((e) => ({
          id: e.id, title: e.id === 'cal-pt' ? 'Physical Therapy' : 'Neurology', start: e.start,
          place_name: 'Kaiser Oakland', place_address: '3600 Broadway, Oakland', place_phone: '',
        }))
      state.riders[rid].calendar = calendar
      return { calendar, skipped: entries.length - calendar.length }
    }],
    ['GET', /^\/riders\/([^/]+)\/trips$/, ([rid]) => Object.values(state.trips).filter((t) => t.rider_id === rid)],
    ['GET', /^\/riders\/([^/]+)\/messages$/, ([rid]) => state.threads[rid] || []],
    [
      'POST',
      /^\/riders\/([^/]+)\/messages$/,
      ([rid], body) => [post(rid, 'rider', body.text), post(rid, 'agent', `Reply to: ${body.text}`)],
    ],
    [
      'POST',
      /^\/riders\/([^/]+)\/voice$/,
      ([rid]) => ({ transcript: 'When is my ride?', messages: [post(rid, 'rider', 'When is my ride?'), post(rid, 'agent', 'At 2:30.')] }),
    ],
    ['POST', /^\/speech$/, () => new Response('mp3', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })],
    [
      'POST',
      /^\/trips$/,
      (_, body) => {
        const t = {
          title: '', rider_id: '', calendar_event_id: '', certainty: 0.9, notes: '',
          permissions: { may_call_appointment: true, share_rider_name: true, max_calls: 3 },
          ...body,
          id: id('t'), created_at: now(), status: 'planning', policy: null, plan: null,
          booked_pickup: null, live: { van_eta: null, picked_up_at: null, arrived_at: null },
          outlook: null, calls_used: 0, late_notice: null, error: '',
        }
        state.trips[t.id] = t
        state.events[t.id] = []
        log(t.id, 'planning', 'Planning the ride.')
        if (t.rider_id) emit(`/riders/${t.rider_id}/stream`, 'trips', t)
        // A planner that finishes (or fails) right after the trip is created.
        if (hooks.tripCreated) setTimeout(() => hooks.tripCreated(t.id), 5)
        return t
      },
    ],
    ['GET', /^\/trips\/([^/]+)$/, ([tid]) => trip(tid) || json({ detail: 'Trip not found' }, 404)],
    ['GET', /^\/trips\/([^/]+)\/events$/, ([tid]) => state.events[tid] || []],
    // A trip with a rider shares the rider's conversation; one without has its own.
    ['GET', /^\/trips\/([^/]+)\/messages$/, ([tid]) => state.threads[trip(tid).rider_id || tid] || []],
    [
      'POST',
      /^\/trips\/([^/]+)\/messages$/,
      ([tid], body) => {
        const thread = trip(tid).rider_id || tid
        return [post(thread, 'rider', body.text), post(thread, 'agent', `Reply to: ${body.text}`)]
      },
    ],
    [
      'POST',
      /^\/trips\/([^/]+)\/plan$/,
      ([tid]) => {
        update(tid, { status: 'planning', error: '' })
        log(tid, 'planning', 'Planning the ride again.')
        return trip(tid)
      },
    ],
    [
      'POST',
      /^\/trips\/([^/]+)\/book$/,
      ([tid], body) => update(tid, { status: 'booked', booked_pickup: body.pickup_time }),
    ],
    [
      'POST',
      /^\/trips\/([^/]+)\/status$/,
      ([tid], body) => {
        const at = body.at || now()
        const t = trip(tid)
        if (body.kind === 'van_eta') t.live.van_eta = at
        if (body.kind === 'picked_up') Object.assign(t, { status: 'riding', live: { ...t.live, picked_up_at: at } })
        if (body.kind === 'arrived') Object.assign(t, { status: 'completed', live: { ...t.live, arrived_at: at } })
        log(tid, 'status', `Status: ${body.kind}.`)
        return t
      },
    ],
  ]

  // ---- fetch ------------------------------------------------------------------

  async function fetch(url, { method = 'GET', headers = {}, body } = {}) {
    const u = new URL(url)
    const call = `${method} ${u.pathname}`
    requests.push(call)
    if (u.origin !== API_BASE) violations.push(`${call}: sent to ${u.origin}, not the configured API base`)
    if (headers['X-API-Key'] !== API_KEY) violations.push(`${call}: missing or wrong X-API-Key`)

    const route = findRoute(method, u.pathname)
    if (!route) {
      violations.push(`${call}: no such route in the backend`)
      return json({ detail: 'Not Found' }, 404)
    }
    let parsed
    if (typeof body === 'string') {
      parsed = JSON.parse(body)
      bodies.push({ call, body: parsed })
      const schema = requestSchema(route.op)
      if (!schema) violations.push(`${call}: sends a JSON body the backend doesn't read`)
      else validate(schema, parsed, { strict: true }).forEach((p) => violations.push(`${call} body ${p}`))
    } else if (requestSchema(route.op) && route.op.requestBody.required) {
      violations.push(`${call}: the backend needs a JSON body`)
    }

    const failure = failures.findIndex((f) => f.call === call)
    if (failure >= 0) {
      const [{ status, detail }] = failures.splice(failure, 1)
      return json({ detail }, status)
    }

    const handler = routes.find(([m, re]) => m === method && re.test(u.pathname))
    if (!handler) {
      violations.push(`${call}: exists in the backend but the fake backend doesn't handle it; add it to test/fakeBackend.js`)
      return json({ detail: 'not faked' }, 501)
    }
    const out = await handler[2](u.pathname.match(handler[1]).slice(1), parsed)
    if (out instanceof Response) return out
    const schema = responseSchema(route.op)
    if (schema) validate(schema, out).forEach((p) => violations.push(`fake response for ${call}: ${p}`))
    return json(structuredClone(out))
  }

  // ---- the backend side of the story -------------------------------------------

  const helpers = {
    trip,
    failNext: (call, status = 500, detail = 'Internal Server Error') => failures.push({ call, status, detail }),
    tripsFor: (rid) => Object.values(state.trips).filter((t) => t.rider_id === rid),
    seedTrip(fields) {
      const t = {
        title: 'Neurology', rider_id: '', calendar_event_id: '', certainty: 0.9, notes: '',
        rider: { name: 'Denise Carter' },
        appointment: { name: 'Kaiser Oakland', phone: '' },
        origin: '1520 Grand Ave, Oakland', dest: '3600 Broadway, Oakland',
        permissions: { may_call_appointment: true, share_rider_name: true, max_calls: 3 },
        id: id('t'), created_at: now(), status: 'planning', policy: null, plan: null,
        booked_pickup: null, live: { van_eta: null, picked_up_at: null, arrived_at: null },
        outlook: null, calls_used: 0, late_notice: null, error: '',
        ...fields,
      }
      state.trips[t.id] = t
      state.events[t.id] = []
      return t
    },
    finishPlanning(tripId, pickupTime) {
      const t = trip(tripId)
      const pickup = pickupTime || new Date(new Date(t.arrive_by) - 75 * 60_000).toISOString()
      const option = { pickup_time: pickup, p_on_time: 0.92, expected_wait_minutes: 12 }
      update(tripId, {
        status: 'planned',
        plan: { recommended: option, options: [option], tradeoff: [option], explanation: 'Leaves room for traffic.', created_at: now() },
      })
      log(tripId, 'plan_ready', 'Plan ready.')
    },
    failPlanning(tripId) {
      update(tripId, { status: 'failed', error: 'model timeout' })
      log(tripId, 'planning_failed', 'Planning failed.')
    },
    startLateCall(tripId, minutesLate = 25) {
      const t = trip(tripId)
      update(tripId, { outlook: { checked_at: now(), p_on_time: 0.3, expected_arrival: t.arrive_by, minutes_late: minutesLate } })
      log(tripId, 'call_started', `Calling ${t.appointment.name}.`, { call_id: 'c1', call_kind: 'late_notice' })
    },
    callProgress(tripId, lines) {
      log(tripId, 'call_progress', 'Call in progress.', { call_id: 'c1', call_kind: 'late_notice', lines })
    },
    endLateCall(tripId, result, transcript = []) {
      const t = trip(tripId)
      log(tripId, 'call_ended', `Call with ${t.appointment.name} ended.`, {
        call_id: 'c1', call_kind: 'late_notice', status: 'completed', result, transcript,
      })
    },
    moveAppointment(tripId, newTime) {
      update(tripId, { arrive_by: newTime })
      log(tripId, 'appointment_moved', 'Appointment moved.')
    },
    agentNotice(riderId, text) {
      return post(riderId, 'agent', text, 'notice')
    },
    // A trip Leeway scheduled in chat, announced only on the rider stream.
    scheduleFromChat(riderId, fields) {
      const t = helpers.seedTrip({ rider_id: riderId, ...fields })
      emit(`/riders/${riderId}/stream`, 'trips', t)
      return t
    },
    openStreams: () => [...streams].map((s) => s.path),
  }

  return { fetch, EventSource: FakeEventSource, requests, bodies, violations, state, hooks, ...helpers }
}
