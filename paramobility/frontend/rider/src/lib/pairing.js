// Pairing this phone with the dashboard's presentation. The dashboard's setup
// panel shows a QR code for /?pair=<rider id>#key=<API key>: opening it makes
// this phone that rider, so it shows the presentation ride as the film plays
// it, and keeps the key here (the fragment never reaches a server, and the
// deployed app has no key built in). Runs before the app reads its storage
// (main.jsx imports it first).

export const KEY_STORAGE = 'leeway.key'
const FLOW_STORAGE = 'leeway.v2' // the app's own data (state/useLeewayFlow.js)

;(function pair() {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const riderId = query.get('pair')
  if (!riderId) return
  try {
    const saved = JSON.parse(localStorage.getItem(FLOW_STORAGE) || '{}')
    // A fresh start as that rider: nothing of the last rider's carries over.
    localStorage.setItem(FLOW_STORAGE, JSON.stringify({ callPhone: saved.callPhone || '', confirmations: {}, riderId, paired: true }))
    if (hash.get('key')) localStorage.setItem(KEY_STORAGE, hash.get('key'))
  } catch {
    // private mode: the app starts as a new rider instead
  }
  // Keep the key out of the address bar.
  window.history.replaceState(null, '', window.location.pathname)
})()

// The key this phone was given when it was paired, if any.
export function pairedKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}
