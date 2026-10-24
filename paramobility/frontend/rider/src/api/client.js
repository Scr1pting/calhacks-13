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

async function send(method, path, { json, form } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'X-API-Key': API_KEY,
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : form,
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
  return res
}

const request = async (method, path, json) => (await send(method, path, { json })).json()

export const api = {
  createTrip: (tripRequest) => request('POST', '/trips', tripRequest),
  getTrip: (id) => request('GET', `/trips/${id}`),
  events: (id) => request('GET', `/trips/${id}/events`),
  messages: (id) => request('GET', `/trips/${id}/messages`),
  sendMessage: (id, text) => request('POST', `/trips/${id}/messages`, { text }),
  replan: (id, certainty) => request('POST', `/trips/${id}/plan`, certainty ? { certainty } : {}),
  book: (id, pickupTime) => request('POST', `/trips/${id}/book`, { pickup_time: pickupTime }),
  status: (id, kind, at) => request('POST', `/trips/${id}/status`, at ? { kind, at } : { kind }),

  // The rider: profile and calendar, all their trips, and their conversation with Leeway.
  putRider: (id, profile) => request('PUT', `/riders/${id}`, profile),
  riderTrips: (id) => request('GET', `/riders/${id}/trips`),
  riderMessages: (id) => request('GET', `/riders/${id}/messages`),
  sendRiderMessage: (id, text) => request('POST', `/riders/${id}/messages`, { text }),

  // Voice: a recording in, {transcript, messages} out; then Leeway's reply as MP3.
  async sendVoice(id, recording) {
    const form = new FormData()
    form.append('audio', recording, `speech.${recording.type.includes('mp4') ? 'mp4' : 'webm'}`)
    return (await send('POST', `/riders/${id}/voice`, { form })).json()
  },
  async speech(text) {
    return (await send('POST', '/speech', { json: { text } })).blob()
  },
}

// Live updates for one trip's activity log. The stream functions return a
// function that closes the stream. EventSource can't send headers, so the key
// goes in the query string.
export function streamTrip(id, { onEvent }) {
  return stream(`/trips/${id}/stream`, { events: onEvent })
}

// The rider's conversation (`onMessage`) and trips created for them, e.g. by
// the chat agent (`onTrip`).
export function streamRider(id, { onMessage, onTrip }) {
  return stream(`/riders/${id}/stream`, { messages: onMessage, trips: onTrip })
}

function stream(path, handlers) {
  const es = new EventSource(`${API_BASE}${path}?api_key=${encodeURIComponent(API_KEY)}`)
  for (const [event, handle] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => handle(JSON.parse(e.data)))
  }
  return () => es.close()
}
