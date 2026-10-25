'use dom'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ROUTE, DESTINATION, alongRoute } from '../lib/liveRoute.js'

// Grayscale OpenStreetMap, rider + destination markers, no route line (per
// the design: "No route is drawn" — Leeway doesn't know the driver's path).
// `progress` (0–1) is a sample position; see lib/liveRoute.js. `route`,
// `destination` and `position` ([lat, lng]), when the phone tracks the ride,
// are where it really starts, ends and is.
//
// An Expo DOM component: the same Leaflet map as the web app's LiveMap,
// rendered as is on web and in a webview on iOS/Android (size it with the
// `dom` prop there). Props cross to the webview, so they stay plain values.
export default function LiveMap({ progress, heavyTraffic, label, route = ROUTE, destination = DESTINATION, position }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    map.getPane('tilePane').style.filter = 'grayscale(1) brightness(1.04) contrast(.88)'

    haloRef.current = L.circle(route[0], {
      radius: 420,
      stroke: false,
      fillColor: '#D08A2E',
      fillOpacity: 0,
    }).addTo(map)
    L.circleMarker(destination, { radius: 9, color: '#FFFFFF', weight: 3, fillColor: '#2FA36B', fillOpacity: 1 }).addTo(
      map,
    )
    riderRef.current = L.circleMarker(route[0], {
      radius: 10,
      color: '#FFFFFF',
      weight: 4,
      fillColor: '#4A3BB8',
      fillOpacity: 1,
    }).addTo(map)

    const fit = () => {
      map.invalidateSize()
      map.fitBounds(L.latLngBounds(route), { padding: [28, 28], maxZoom: 16 })
    }
    fit()
    const t1 = setTimeout(fit, 150)
    const t2 = setTimeout(fit, 600)

    mapRef.current = map
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const pos = position || alongRoute(route, progress)
    riderRef.current?.setLatLng(pos)
    haloRef.current?.setLatLng(pos)
    haloRef.current?.setStyle({ fillOpacity: heavyTraffic ? 0.22 : 0 })
    // A ride that leaves the area on screen (a detour) widens it.
    const map = mapRef.current
    if (position && map && !map.getBounds().contains(pos)) {
      map.fitBounds(L.latLngBounds([...route, pos]), { padding: [28, 28], maxZoom: 16 })
    }
  }, [route, progress, heavyTraffic, position])

  // In the webview the map fills the whole page; on web it fills its parent.
  const fill = process.env.EXPO_DOM_HOST_OS
    ? { position: 'fixed', inset: 0 }
    : { width: '100%', height: '100%' }
  return <div ref={elRef} role="img" aria-label={label} style={{ ...fill, background: '#EDEDEB' }} />
}
