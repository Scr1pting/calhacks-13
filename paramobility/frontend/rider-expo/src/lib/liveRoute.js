// Sample GPS path for the "live trip" map, ported from the design
// prototype's ROUTE/routeAt. The backend has no real position feed (no lat/
// lng on Trip — see paramobility/backend/app/core/schemas.py), so this fakes
// a moving position the same way the prototype does. Per the prototype's own
// README: "do not build a route from them" — it's a demo position, not
// routing. Everything else on the live-trip screen (odds, reason, timing)
// comes from the real backend.
export const ROUTE = [
  [37.803, -122.2723],
  [37.8063, -122.2702],
  [37.8089, -122.2684],
  [37.8112, -122.2669],
  [37.814, -122.2651],
  [37.8165, -122.2636],
  [37.8191, -122.2617],
  [37.8215, -122.2594],
  [37.8236, -122.2574],
  [37.8246, -122.2563], // Kaiser Oakland, 3600 Broadway
]

function routeCumulative(route) {
  const c = [0]
  for (let i = 1; i < route.length; i++) {
    const dy = route[i][0] - route[i - 1][0]
    const dx = (route[i][1] - route[i - 1][1]) * Math.cos((route[i][0] * Math.PI) / 180)
    c.push(c[i - 1] + Math.hypot(dx, dy))
  }
  return c
}
const CUM = routeCumulative(ROUTE)

// Position along a route ([lat, lng] points) at progress `p` (0 to 1).
// Pass `cum` (from routeCumulative) when calling often with the same route.
export function alongRoute(route, p, cum = routeCumulative(route)) {
  const d = Math.max(0, Math.min(1, p)) * cum[cum.length - 1]
  for (let i = 1; i < route.length; i++) {
    if (d <= cum[i]) {
      const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
      return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f]
    }
  }
  return route[route.length - 1]
}

// Position along the sample route at progress `p` (0 to 1).
export const routeAt = (p) => alongRoute(ROUTE, p, CUM)

export function milesBetween(a, b) {
  const r = Math.PI / 180
  const dLat = (b[0] - a[0]) * r
  const dLng = (b[1] - a[1]) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

export const DESTINATION = ROUTE[ROUTE.length - 1]
