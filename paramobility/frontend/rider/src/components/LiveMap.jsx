import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ROUTE, DESTINATION, routeAt } from '../lib/liveRoute.js'
import './LiveMap.css'

// Grayscale OpenStreetMap, rider + destination markers, no route line (per
// the design: "No route is drawn" — Leeway doesn't know the driver's path).
// `progress` (0–1) is a sample position; see lib/liveRoute.js.
export default function LiveMap({ progress, heavyTraffic, label }) {
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

    mapRef.current = map
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const pos = routeAt(progress)
    riderRef.current?.setLatLng(pos)
    haloRef.current?.setLatLng(pos)
    haloRef.current?.setStyle({ fillOpacity: heavyTraffic ? 0.22 : 0 })
  }, [progress, heavyTraffic])

  return <div ref={elRef} className="lw-live-map" role="img" aria-label={label} />
}
