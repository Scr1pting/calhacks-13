// Client for the Paramobility backend (paramobility/docs/INTERFACES.md): the
// calendar sync and planning and booking rides for calendar appointments. The
// rest of the app still runs on the sample data in src/data.
//
// Configure with Expo public env vars (in .env or the shell):
//   EXPO_PUBLIC_API_BASE  backend URL, defaults to the deployed server
//   EXPO_PUBLIC_API_KEY   shared key the backend expects as X-API-Key

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'https://api.cal.fuzz.li').replace(/\/$/, '')
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || ''

async function request(method, path, json) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`)
  return res.json()
}

export const api = {
  putRider: (id, profile) => request('PUT', `/riders/${id}`, profile),
  // Every calendar entry in; {calendar, skipped} out: the ones that need a ride.
  syncCalendar: (id, entries) => request('PUT', `/riders/${id}/calendar`, { entries }),
  createTrip: (tripRequest) => request('POST', '/trips', tripRequest),
  getTrip: (id) => request('GET', `/trips/${id}`),
  book: (id, pickupTime) => request('POST', `/trips/${id}/book`, { pickup_time: pickupTime }),
}
