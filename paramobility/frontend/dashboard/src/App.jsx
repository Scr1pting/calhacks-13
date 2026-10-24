import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { AttributionControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { mapStyle } from './map/style.js'
import { buildLayers } from './map/layers.js'
import { headingAhead, loadFleet, vanState } from './sim/fleet.js'
import Hud from './hud/Hud.jsx'

// Downtown Oakland, low and tilted, so the 3D city fills the frame.
const HOME = { center: [-122.2715, 37.8045], zoom: 14.6, pitch: 64, bearing: -28 }
const FOLLOW = { zoom: 17.2, pitch: 66 }
const GLIDE_MS = 1800

const parseClock = (s) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
const lerp = (a, b, k) => a + (b - a) * k
const easeOut = (p) => 1 - (1 - p) ** 3
const shortestTurn = (from, to) => ((to - from + 540) % 360) - 180

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
  // `dirty` asks the loop to redraw once; while paused and idle it draws nothing.
  const sim = useRef({ t: 0, playing: true, speed: 60, selected: null, follow: false, glide: null, camBearing: 0, dirty: true })
  const [view, setView] = useState(sim.current)
  const refresh = useCallback(() => setView({ ...sim.current }), [])
  // A change the map has to show: redraw, and update the HUD.
  const touch = useCallback(() => {
    sim.current.dirty = true
    refresh()
  }, [refresh])
  const maria = useMemo(() => fleet && mariaTrip(fleet), [fleet])

  useEffect(() => {
    loadFleet()
      .then((f) => {
        // ?t=10:15 starts at that time; otherwise at the morning rush.
        const params = new URLSearchParams(window.location.search)
        const [h, m] = (params.get('t') || '8:00').split(':').map(Number)
        sim.current.t = Math.min(f.meta.end, Math.max(f.meta.start, h * 60 + (m || 0)))
        setFleet(f)
        touch()
      })
      .catch((e) => setError(e.message))
  }, [touch])

  useEffect(() => {
    const m = new maplibregl.Map({
      container: mapEl.current,
      style: mapStyle,
      ...HOME,
      maxPitch: 80,
      // Thousands of 3D buildings: render at most 1.5x, even on 2x/3x screens.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
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
        sim.current.glide = null
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
      touch()
    },
    [touch],
  )

  // Chase view behind the selected van: glide in, or cut straight to it.
  function startFollow({ instant = false } = {}) {
    const s = sim.current
    const van = fleet?.vansById[s.selected]
    const state = van && vanState(van, s.t)
    if (!state) return
    const m = map.current
    const heading = headingAhead(van, s.t) ?? state.heading
    s.follow = true
    s.dirty = true
    if (instant) {
      s.glide = null
      s.camBearing = heading
      m.jumpTo({ center: state.pos, bearing: heading, ...FOLLOW })
      return
    }
    // The glide is anchored to the van: the camera's offset from it shrinks to
    // zero over GLIDE_MS, so it lands on a moving van without lagging or snapping.
    const c = m.getCenter()
    s.camBearing = m.getBearing()
    s.glide = {
      start: performance.now(),
      offset: [c.lng - state.pos[0], c.lat - state.pos[1]],
      zoom: m.getZoom(),
      pitch: m.getPitch(),
    }
  }

  // The animation loop: advance the clock, move every van, steer the camera.
  // It only draws when something changed, so a paused map leaves the GPU idle.
  useEffect(() => {
    if (!fleet) return undefined
    let raf
    let prev = performance.now()
    // One object for Maria's marker, so its label isn't laid out again every frame.
    const mariaSpot = maria && { pos: maria.pickup.pos }
    const frame = (now) => {
      const s = sim.current
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      if (s.playing) {
        s.t += (dt * s.speed) / 60
        if (s.t > fleet.meta.end) s.t = fleet.meta.start
      }
      if (s.playing || s.dirty || s.glide || s.turning) {
        s.dirty = false
        const states = []
        for (const van of fleet.vans) {
          const st = vanState(van, s.t)
          if (st) states.push(st)
        }
        const mariaWaiting = maria && s.t >= maria.windowStart - 30 && s.t < maria.pickup.t ? mariaSpot : null
        overlay.current.setProps({
          layers: buildLayers({ fleet, t: s.t, states, selectedId: s.selected, mariaWaiting, onPick: select }),
        })
        const st = s.follow && states.find((v) => v.id === s.selected)
        s.turning = false
        if (st) steer(s, st, fleet.vansById[st.id], dt, now)
      }
      raf = requestAnimationFrame(frame)
    }

    function steer(s, st, van, dt, now) {
      // Heading follows the road a little ahead, eased, so the camera doesn't
      // twitch at every vertex of the route.
      const target = headingAhead(van, s.t) ?? s.camBearing
      const turn = shortestTurn(s.camBearing, target)
      s.camBearing += turn * Math.min(1, dt * 2.2)
      s.turning = Math.abs(turn) > 0.1
      const camera = { center: st.pos, bearing: s.camBearing }
      if (s.glide) {
        const p = Math.min(1, (now - s.glide.start) / GLIDE_MS)
        const k = easeOut(p)
        camera.center = [st.pos[0] + s.glide.offset[0] * (1 - k), st.pos[1] + s.glide.offset[1] * (1 - k)]
        camera.zoom = lerp(s.glide.zoom, FOLLOW.zoom, k)
        camera.pitch = lerp(s.glide.pitch, FOLLOW.pitch, k)
        if (p >= 1) s.glide = null
      }
      map.current.jumpTo(camera)
    }

    raf = requestAnimationFrame(frame)
    const hud = setInterval(refresh, 250)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(hud)
    }
  }, [fleet, maria, refresh, select])

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
        touch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [touch])

  const controls = {
    setTime: (t) => {
      sim.current.t = t
      touch()
    },
    togglePlay: () => {
      sim.current.playing = !sim.current.playing
      touch()
    },
    setSpeed: (speed) => {
      sim.current.speed = speed
      touch()
    },
    select: (id) => select(id),
    follow: () => {
      startFollow()
      touch()
    },
    unfollow: () => {
      sim.current.follow = false
      sim.current.glide = null
      touch()
    },
    clearSelection: () => {
      sim.current.selected = null
      sim.current.follow = false
      sim.current.glide = null
      map.current.easeTo({ ...HOME, duration: 1600 })
      touch()
    },
    followMaria: ({ instant = false } = {}) => {
      if (!maria) return
      const s = sim.current
      // Jump to just before her window opens if her ride is already over.
      if (s.t < maria.windowStart - 45 || s.t > (maria.dropoff?.t ?? maria.pickup.t)) {
        s.t = maria.windowStart - 20
      }
      s.selected = maria.van_id
      startFollow({ instant })
      touch()
    },
  }

  return (
    <div className="app">
      <div ref={mapEl} className="map" />
      {error && <div className="error">{error}</div>}
      {fleet && <Hud fleet={fleet} view={view} controls={controls} maria={maria} />}
      {!fleet && !error && <div className="loading">Loading the simulated day…</div>}
    </div>
  )
}
