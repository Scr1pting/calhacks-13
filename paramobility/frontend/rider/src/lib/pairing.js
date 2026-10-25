// Pairing this phone with the dashboard's presentation. The dashboard's setup
// panel shows a six-digit code (and a QR for /rider/index.html?c=<code>); the
// phone trades it with the server for the presentation's rider id and the API
// key (the deployed app has none built in), becomes that rider, and keeps the
// key here. main.jsx waits for `pairing` before it starts the app.

export const KEY_STORAGE = 'leeway.key'
const FLOW_STORAGE = 'leeway.v2' // the app's own data (state/useLeewayFlow.js)
const API = (import.meta.env.VITE_API_BASE || 'https://api.cal.fuzz.li').replace(/\/$/, '')

function become(riderId, key) {
  try {
    const saved = JSON.parse(localStorage.getItem(FLOW_STORAGE) || '{}')
    // A fresh start as that rider: nothing of the last rider's carries over.
    localStorage.setItem(FLOW_STORAGE, JSON.stringify({ callPhone: saved.callPhone || '', confirmations: {}, riderId, paired: true }))
    if (key) localStorage.setItem(KEY_STORAGE, key)
  } catch {
    // private mode: the app starts as a new rider instead
  }
}

// Trade a code for the rider and the key. Throws with the server's reason.
export async function claim(code) {
  let res
  try {
    res = await fetch(`${API}/pairing/${encodeURIComponent(code.replace(/\D/g, ''))}`, { method: 'POST' })
  } catch {
    throw new Error('Can’t reach Leeway’s server. Check this phone’s internet connection.')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail || 'That didn’t work. Try again.')
  become(body.rider_id, body.api_key)
}

// The pairing in the address, if any, done before the app starts. A code that
// fails leaves the app to ask for one (pairingError says why).
export let pairingError = ''
export const pairing = (async () => {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  try {
    if (query.get('c')) await claim(query.get('c'))
    else if (query.get('pair')) become(query.get('pair'), hash.get('key'))
  } catch (e) {
    pairingError = e.message
  }
  // Keep the code and any key out of the address bar.
  if (query.get('c') || query.get('pair')) window.history.replaceState(null, '', window.location.pathname)
})()

// The key this phone was given when it was paired, if any.
export function pairedKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

// No key at all: the app can't talk to the server until it's paired.
export const needsPairing = () => !(import.meta.env.VITE_API_KEY || '').trim() && !pairedKey()
