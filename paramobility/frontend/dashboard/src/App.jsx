import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, { AttributionControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { mapStyle } from './map/style.js'
import { buildLayers } from './map/layers.js'
import { loadFleet, vanState } from './sim/fleet.js'
import Hud from './hud/Hud.jsx'

// Downtown Oakland, low and tilted, so the 3D city fills the frame.
const HOME = { center: [-122.2715, 37.8045], zoom: 14.6, pitch: 64, bearing: -28 }
const FOLLOW = { zoom: 17.2, pitch: 66 }

const parseClock = (s) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

// Maria, the demo rider: where and when she waits for her van.
function mariaTrip(fleet) {
  const id = fleet.meta.persona?.trip_id
  const pickup = fleet.stops.find((s) => s.trip === id && s.kind === 'P')
  const dropoff = fleet.stops.find((s) => s.trip === id && s.kind === 'D')
  if (!pickup) return null
  return { ...fleet.meta.persona, pickup, dropoff, windowStart: parseClock(pickup.window[0]) }
}

export default function App() {
  const mapEl = useRef(null)
  const map = useRef(null)
  const overlay = useRef(null)
  const [fleet, setFleet] = useState(null)
  const [error, setError] = useState('')
  // Everything the animation loop reads lives in a ref, so it doesn't wait on React.
  const sim = useRef({ t: 0, playing: true, speed: 60, selected: null, follow: false, followSince: 0, camBearing: 0 })
  const [view, setView] = useState(sim.current)
  const refresh = useCallback(() => setView({ ...sim.current }), [])

  useEffect(() => {
    loadFleet()
      .then((f) => {
        // ?t=10:15 starts at that time; otherwise at the morning rush.
        const params = new URLSearchParams(window.location.search)
        const [h, m] = (params.get('t') || '8:00').split(':').map(Number)
        sim.current.t = Math.min(f.meta.end, Math.max(f.meta.start, h * 60 + (m || 0)))
        setFleet(f)
        refresh()
      })
      .catch((e) => setError(e.message))
  }, [refresh])

  useEffect(() => {
    const m = new maplibregl.Map({
      container: mapEl.current,
      style: mapStyle,
      ...HOME,
      maxPitch: 80,
      hash: 'camera', // the camera position lives in the URL, so views can be shared
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    })
    const o = new MapboxOverlay({
      interleaved: true,
      layers: [],
      getTooltip: ({ object, layer }) =>
        object && layer?.id === 'halos'
          ? {
              html: `<b>Van ${object.id}</b><br/>${object.behind > 0.5 ? `${object.behind.toFixed(0)} min behind plan` : 'On plan'}`,
              className: 'deck-tip',
            }
          : null,
    })
    m.addControl(o)
    m.addControl(new AttributionControl({ compact: true }), 'bottom-left')
    // Taking the camera by hand stops following.
    const release = () => {
      if (sim.current.follow) {
        sim.current.follow = false
        refresh()
      }
    }
    m.on('dragstart', release)
    m.on('rotatestart', (e) => e.originalEvent && release())
    map.current = m
    overlay.current = o
    return () => m.remove()
  }, [refresh])

  const select = useCallback(
    (id) => {
      sim.current.selected = id
      refresh()
    },
    [refresh],
  )

  // Glide in to a chase view behind the selected van, or cut straight to it.
  function startFollow({ instant = false } = {}) {
    const s = sim.current
    const van = fleet?.vansById[s.selected]
    const state = van && vanState(van, s.t)
    if (!state) return
    s.follow = true
    if (instant) {
      s.followSince = -Infinity
      s.camBearing = state.heading
      map.current.jumpTo({ center: state.pos, bearing: state.heading, ...FOLLOW })
    } else {
      s.followSince = performance.now()
      s.camBearing = map.current.getBearing()
    }
  }

  // The animation loop: advance the clock, move every van, steer the camera.
  useEffect(() => {
    if (!fleet) return undefined
    const maria = mariaTrip(fleet)
    let raf
    let prev = performance.now()
    const frame = (now) => {
      const s = sim.current
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      if (s.playing) {
        s.t += (dt * s.speed) / 60
        if (s.t > fleet.meta.end) s.t = fleet.meta.start
      }
      const states = []
      for (const van of fleet.vans) {
        const st = vanState(van, s.t)
        if (st) states.push(st)
      }
      const mariaWaiting =
        maria && s.t >= maria.windowStart - 30 && s.t < maria.pickup.t ? { pos: maria.pickup.pos } : null
      overlay.current.setProps({
        layers: buildLayers({
          fleet,
          t: s.t,
          states,
          selectedId: s.selected,
          mariaWaiting,
          onPick: (id) => select(id),
        }),
      })
      const st = s.follow && states.find((v) => v.id === s.selected)
      if (st) {
        // Chase camera. Heading eases toward the van's, the short way round. For the
        // first moments it also glides in to a low, close view; after that the
        // rider's own zoom and tilt are kept.
        const m = map.current
        const ease = Math.min(1, dt * 1.8)
        const delta = ((st.heading - s.camBearing + 540) % 360) - 180
        s.camBearing += delta * ease
        const camera = { center: st.pos, bearing: s.camBearing }
        if (now - s.followSince < 3000) {
          const c = m.getCenter()
          const k = Math.min(1, dt * 2.5)
          camera.center = [c.lng + (st.pos[0] - c.lng) * k, c.lat + (st.pos[1] - c.lat) * k]
          camera.zoom = m.getZoom() + (FOLLOW.zoom - m.getZoom()) * k
          camera.pitch = m.getPitch() + (FOLLOW.pitch - m.getPitch()) * k
        }
        m.jumpTo(camera)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const hud = setInterval(refresh, 250)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(hud)
    }
  }, [fleet, refresh, select])

  // ?follow=maria starts by following Maria's ride (handy for demos and kiosks).
  useEffect(() => {
    if (!fleet || new URLSearchParams(window.location.search).get('follow') !== 'maria') return
    const go = () => controls.followMaria({ instant: true })
    if (map.current.loaded()) go()
    else map.current.once('load', go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet])

  // Space plays and pauses.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        sim.current.playing = !sim.current.playing
        refresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  const controls = {
    setTime: (t) => {
      sim.current.t = t
      refresh()
    },
    togglePlay: () => {
      sim.current.playing = !sim.current.playing
      refresh()
    },
    setSpeed: (speed) => {
      sim.current.speed = speed
      refresh()
    },
    select: (id) => select(id),
    follow: () => {
      startFollow()
      refresh()
    },
    unfollow: () => {
      sim.current.follow = false
      refresh()
    },
    clearSelection: () => {
      sim.current.selected = null
      sim.current.follow = false
      map.current.easeTo({ ...HOME, duration: 1600 })
      refresh()
    },
    followMaria: ({ instant = false } = {}) => {
      const maria = mariaTrip(fleet)
      if (!maria) return
      const s = sim.current
      // Jump to just before her window opens if her ride is already over.
      if (s.t < maria.windowStart - 45 || s.t > (maria.dropoff?.t ?? maria.pickup.t)) {
        s.t = maria.windowStart - 20
      }
      s.selected = maria.van_id
      startFollow({ instant })
      refresh()
    },
  }

  return (
    <div className="app">
      <div ref={mapEl} className="map" />
      {error && <div className="error">{error}</div>}
      {fleet && <Hud fleet={fleet} view={view} controls={controls} maria={mariaTrip(fleet)} />}
      {!fleet && !error && <div className="loading">Loading the simulated day…</div>}
    </div>
  )
}
