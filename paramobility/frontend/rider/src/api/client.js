// Client for the Paramobility backend (paramobility/docs/INTERFACES.md).
//
// Configure with Vite env vars (see .env.example):
//   VITE_API_BASE  backend URL, defaults to the deployed server
//   VITE_API_KEY   shared key the backend expects as X-API-Key

export const API_BASE = (import.meta.env.VITE_API_BASE || 'https://api.cal.fuzz.li').replace(/\/$/, '')
const API_KEY = import.meta.env.VITE_API_KEY || ''

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function request(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'X-API-Key': API_KEY,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json()
}

export const api = {
  createTrip: (tripRequest) => request('POST', '/trips', tripRequest),
  getTrip: (id) => request('GET', `/trips/${id}`),
  events: (id) => request('GET', `/trips/${id}/events`),
  messages: (id) => request('GET', `/trips/${id}/messages`),
  sendMessage: (id, text) => request('POST', `/trips/${id}/messages`, { text }),
  replan: (id, certainty) => request('POST', `/trips/${id}/plan`, certainty ? { certainty } : {}),
  book: (id, pickupTime) => request('POST', `/trips/${id}/book`, { pickup_time: pickupTime }),
  status: (id, kind, at) => request('POST', `/trips/${id}/status`, at ? { kind, at } : { kind }),
}

// Live updates for one trip: `onEvent` gets activity-log entries, `onMessage`
// chat messages. Returns a function that closes the stream. EventSource can't
// send headers, so the key goes in the query string.
export function streamTrip(id, { onEvent, onMessage }) {
  const es = new EventSource(`${API_BASE}/trips/${id}/stream?api_key=${encodeURIComponent(API_KEY)}`)
  es.addEventListener('events', (e) => onEvent(JSON.parse(e.data)))
  es.addEventListener('messages', (e) => onMessage(JSON.parse(e.data)))
  return () => es.close()
}
