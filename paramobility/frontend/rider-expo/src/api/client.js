// Client for the Paramobility backend (paramobility/docs/INTERFACES.md).
//
// Configure with Expo public env vars (see .env.example):
//   EXPO_PUBLIC_API_BASE  backend URL, defaults to the deployed server
//   EXPO_PUBLIC_API_KEY   shared key the backend expects as X-API-Key

export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'https://api.cal.fuzz.li').replace(/\/$/, '')
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || ''

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
  // Every calendar entry in; {calendar, skipped} out: the ones that need a ride.
  syncCalendar: (id, entries) => request('PUT', `/riders/${id}/calendar`, { entries }),
  riderTrips: (id) => request('GET', `/riders/${id}/trips`),
  riderMessages: (id) => request('GET', `/riders/${id}/messages`),
  sendRiderMessage: (id, text) => request('POST', `/riders/${id}/messages`, { text }),

  // The numbers Leeway may call: {phone, approved, reason}. Adding one needs the server's PIN.
  checkCallNumber: (phone) => request('POST', '/call-numbers/check', { phone }),
  addCallNumber: (phone, pin) => request('POST', '/call-numbers', { phone, pin }),

  // Voice: a recording in, {transcript, messages} out; then Leeway's reply as MP3.
  // On web the recording is a Blob; on iOS/Android it's an expo-file-system
  // File (lib/recorder.js), which already carries its name and type.
  async sendVoice(id, recording) {
    const form = new FormData()
    if (recording.uri) {
      form.append('audio', recording)
    } else {
      const ext = recording.type.includes('wav') ? 'wav' : recording.type.includes('mp4') ? 'mp4' : 'webm'
      form.append('audio', recording, `speech.${ext}`)
    }
    return (await send('POST', `/riders/${id}/voice`, { form })).json()
  },
  // The MP3 as an ArrayBuffer, which lib/recorder plays.
  async speech(text) {
    return (await send('POST', '/speech', { json: { text } })).arrayBuffer()
  },
}

// Live updates for one trip's activity log. The stream functions return a
// function that closes the stream.
//
// The backend doesn't replay what it published before a stream connected, so
// `onOpen` runs each time the stream (re)connects: fetch the current state
// then, or whatever happened in between (a plan failing in the first second, a
// backend restart) never reaches the app.
export function streamTrip(id, { onEvent, onOpen }) {
  return stream(`/trips/${id}/stream`, { events: onEvent }, onOpen)
}

// The rider's conversation (`onMessage`) and trips created for them, e.g. by
// the chat agent (`onTrip`). Open it only once the rider exists on the
// backend (after putRider), or the backend answers 404 until it does.
export function streamRider(id, { onMessage, onTrip, onOpen }) {
  return stream(`/riders/${id}/stream`, { messages: onMessage, trips: onTrip }, onOpen)
}

// Server-sent events over fetch. React Native has no EventSource, but
// expo/fetch (the global fetch on iOS/Android) and browsers can both read a
// response as it streams in, so every platform uses this. Like EventSource,
// it reconnects whenever the stream drops, waiting longer after each failure.
const RETRY_MS = [1000, 2000, 5000, 10000]

function stream(path, handlers, onOpen) {
  let closed = false
  let controller = null
  let failures = 0
  let timer = null

  async function connect() {
    controller = new AbortController()
    try {
      const res = await fetch(API_BASE + path, {
        headers: { 'X-API-Key': API_KEY, Accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`stream ${path}: ${res.status}`)
      failures = 0
      onOpen?.()
      await readEvents(res.body.getReader(), (event, data) => {
        const handle = handlers[event]
        if (handle) handle(JSON.parse(data))
      })
    } catch {
      // dropped, refused or closed: retry below unless closed
    }
    if (closed) return
    timer = setTimeout(connect, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)])
    failures += 1
  }

  connect()
  return () => {
    closed = true
    clearTimeout(timer)
    controller?.abort()
  }
}

// Calls onEvent(name, data) for each event in a text/event-stream body.
async function readEvents(reader, onEvent) {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop()
    for (const block of blocks) {
      let event = 'message'
      const data = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) onEvent(event, data.join('\n'))
    }
  }
}
