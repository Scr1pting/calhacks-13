'use dom'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ROUTE, DESTINATION, routeAt } from '../lib/liveRoute.js'

// Grayscale OpenStreetMap, rider + destination markers, no route line (per
// the design: "No route is drawn" — Leeway doesn't know the driver's path).
// `progress` (0–1) is a sample position; see lib/liveRoute.js.
//
// An Expo DOM component: the same Leaflet map as the web app's LiveMap,
// rendered as is on web and in a webview on iOS/Android (size it with the
// `dom` prop there). Props cross to the webview, so they stay plain values.
export default function LiveMap({ progress, heavyTraffic, label }) {
  const elRef = useRef(null)
  const riderRef = useRef(null)
  const haloRef = useRef(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const map = L.map(el, {
      zoomControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: true,
    })
    map.attributionControl.setPrefix(false)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', // spreads tile requests across 3 hosts instead of hammering one
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      // A transparent tile (rather than a broken-image icon) if one fails to
      // load — the map's own background shows through instead of an error.
      errorTileUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    }).addTo(map)
    map.getPane('tilePane').style.filter = 'grayscale(1) brightness(1.04) contrast(.88)'

    haloRef.current = L.circle(ROUTE[0], {
      radius: 420,
      stroke: false,
      fillColor: '#D08A2E',
      fillOpacity: 0,
    }).addTo(map)
    L.circleMarker(DESTINATION, { radius: 9, color: '#FFFFFF', weight: 3, fillColor: '#2FA36B', fillOpacity: 1 }).addTo(
      map,
    )
    riderRef.current = L.circleMarker(ROUTE[0], {
      radius: 10,
      color: '#FFFFFF',
      weight: 4,
      fillColor: '#4A3BB8',
      fillOpacity: 1,
    }).addTo(map)

    const fit = () => {
      map.invalidateSize()
      map.fitBounds(L.latLngBounds(ROUTE), { padding: [28, 28], maxZoom: 16 })
    }
    fit()
    const t1 = setTimeout(fit, 150)
    const t2 = setTimeout(fit, 600)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      map.remove()
    }
  }, [])

  useEffect(() => {
    const pos = routeAt(progress)
    riderRef.current?.setLatLng(pos)
    haloRef.current?.setLatLng(pos)
    haloRef.current?.setStyle({ fillOpacity: heavyTraffic ? 0.22 : 0 })
  }, [progress, heavyTraffic])

  // In the webview the map fills the whole page; on web it fills its parent.
  const fill = process.env.EXPO_DOM_HOST_OS
    ? { position: 'fixed', inset: 0 }
    : { width: '100%', height: '100%' }
  return <div ref={elRef} role="img" aria-label={label} style={{ ...fill, background: '#EDEDEB' }} />
}
