// Every call in src/api/client.js against the backend's OpenAPI spec: the
// route exists with that method, the body has the fields the backend reads
// (and no fields it would silently drop), and the API key is sent.

import { waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { api, streamRider, streamTrip } from '../src/api/client.js'
import { createFakeBackend } from './fakeBackend.js'

function setup() {
  const backend = createFakeBackend()
  vi.stubGlobal('fetch', backend.fetch)
  vi.stubGlobal('EventSource', backend.EventSource)
  const trip = backend.seedTrip({ rider_id: 'r1', arrive_by: '2026-11-03T14:00:00-08:00' })
  backend.finishPlanning(trip.id)
  return { backend, trip }
}

const tripRequest = {
  rider: { name: 'Denise Carter' },
  appointment: { name: 'Kaiser Oakland', phone: '' },
  title: 'Neurology',
  rider_id: 'r1',
  calendar_event_id: 'cal-neuro',
  origin: '1520 Grand Ave, Oakland',
  dest: '3600 Broadway, Oakland',
  arrive_by: '2026-11-03T14:00:00-08:00',
  certainty: 0.9,
  permissions: { may_call_appointment: false, share_rider_name: true, max_calls: 3 },
}

const profile = {
  name: 'Denise Carter',
  home: '1520 Grand Ave, Oakland',
  time_zone: 'America/Los_Angeles',
  calendar: [],
  permissions: { may_call_appointment: false, share_rider_name: true, max_calls: 3 },
}

const CALLS = {
  createTrip: () => api.createTrip(tripRequest),
  getTrip: (t) => api.getTrip(t.id),
  events: (t) => api.events(t.id),
  messages: (t) => api.messages(t.id),
  sendMessage: (t) => api.sendMessage(t.id, 'hi'),
  replan: (t) => api.replan(t.id),
  'replan with certainty': (t) => api.replan(t.id, 0.8),
  book: (t) => api.book(t.id, t.plan.recommended.pickup_time),
  'status van_eta': (t) => api.status(t.id, 'van_eta', '2026-11-03T13:00:00-08:00'),
  'status arrived': (t) => api.status(t.id, 'arrived'),
  putRider: () => api.putRider('r1', profile),
  riderTrips: () => api.riderTrips('r1'),
  riderMessages: () => api.riderMessages('r1'),
  sendRiderMessage: () => api.sendRiderMessage('r1', 'hi'),
  sendVoice: () => api.sendVoice('r1', new Blob(['wav'], { type: 'audio/wav' })),
  speech: () => api.speech('Hello'),
}

describe('api client matches the backend', () => {
  test.each(Object.keys(CALLS))('%s', async (name) => {
    const { backend, trip } = setup()
    try {
      await CALLS[name](trip)
    } catch (e) {
      // A 501 means the fake backend lacks the route; the violation says so.
      if (!backend.violations.length) throw e
    }
    expect(backend.violations).toEqual([])
  })

  test('streams use real routes, send the key and report when they connect', async () => {
    const { backend, trip } = setup()
    await api.putRider('r1', profile)
    const opened = []
    const closers = [
      streamTrip(trip.id, { onEvent: () => {}, onOpen: () => opened.push('trip') }),
      streamRider('r1', { onMessage: () => {}, onTrip: () => {}, onOpen: () => opened.push('rider') }),
    ]
    await waitFor(() => expect(opened.sort()).toEqual(['rider', 'trip']))
    expect(backend.openStreams()).toEqual([`/trips/${trip.id}/stream`, '/riders/r1/stream'])
    closers.forEach((close) => close())
    expect(backend.violations).toEqual([])
  })
})
