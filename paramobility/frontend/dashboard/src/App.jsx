import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { AttributionControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { mapStyle, setBasemap } from './map/style.js'
import { buildLayers } from './map/layers.js'
import { headingAhead, loadFleet, vanState } from './sim/fleet.js'
import Hud from './hud/Hud.jsx'
import FilmOverlay from './film/FilmOverlay.jsx'
import StoryOverlay from './film/StoryOverlay.jsx'
import { easeStop, filmLength, filmScenes, revealCount, sceneAt } from './film/script.js'
import { storyScenes } from './film/story.js'
import { buildStoryLayers } from './film/storyLayers.js'
import LiveOverlay from './film/LiveOverlay.jsx'
import { liveScenes } from './film/live.js'
import { buildLiveLayers } from './film/liveLayers.js'
import { liveCall } from './film/liveCall.js'
import PresentationOverlay from './film/PresentationOverlay.jsx'
import { presentationScenes } from './film/presentation.js'
import { buildPresentationLayers } from './film/presentationLayers.js'
import { isPaired, loadPresentation, presentationSync } from './film/presentationSync.js'
import { warmLayers } from './film/warm.js'
import { filmRider } from './film/riderApi.js'
import { fontsReady, prefetchShots } from './film/prefetch.js'

// Downtown Oakland, low and tilted, so the 3D city fills the frame.
const HOME = { center: [-122.2715, 37.8045], zoom: 14.6, pitch: 64, bearing: -28 }
const FOLLOW = { zoom: 17.2, pitch: 66 }
const GLIDE_MS = 1800
// How often the presentation posts its clock to the server, in ms.
const CLOCK_MS = 250
// The story frames its shots in the top of the screen, above the words.
const STORY_PADDING = { top: 90, bottom: 330, left: 140, right: 140 }
// The live story and the presentation keep the right of the screen for the phone.
const LIVE_PADDING = { top: 70, bottom: 330, left: 70, right: 540 }

const parseClock = (s) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
const lerp = (a, b, k) => a + (b - a) * k
const easeOut = (p) => 1 - (1 - p) ** 3
const easeInOut = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
const shortestTurn = (from, to) => ((to - from + 540) % 360) - 180

// A camera part way (k) from a to b.
const mixCamera = (a, b, k) => ({
  center: [lerp(a.center[0], b.center[0], k), lerp(a.center[1], b.center[1], k)],
  zoom: lerp(a.zoom, b.zoom, k),
  pitch: lerp(a.pitch, b.pitch, k),
  bearing: a.bearing + shortestTurn(a.bearing, b.bearing) * k,
})

// The flat, rotated camera that fits a story shot's points above the words.
// It fits the points themselves, turned to the shot's bearing, rather than
// their north-up bounding box: turned, that box is far bigger than a diagonal
// route, which would come out small.
function frameCamera(m, scene, padding = STORY_PADDING) {
  const bearing = scene.bearing ?? 90
  const rad = (bearing * Math.PI) / 180
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)]
  // Web Mercator (0-1, y down), then turned so the screen's x and y line up.
  const merc = ([lng, lat]) => {
    const s = Math.sin((lat * Math.PI) / 180)
    return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]
  }
  const turn = ([x, y]) => [x * cos + y * sin, -x * sin + y * cos]
  const pts = scene.frame.map((p) => turn(merc(p)))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const { clientWidth: W, clientHeight: H } = m.getContainer()
  // On a small screen the margins shrink with it, leaving the points at least
  // a third of each side: fixed margins bigger than the window leave no room,
  // and the camera nowhere to go (a blank map).
  const fit = (size, a, b) => Math.min(1, (size * 2) / 3 / Math.max(a + b, 1))
  const kx = fit(W, padding.left, padding.right)
  const ky = fit(H, padding.top, padding.bottom)
  padding = { left: padding.left * kx, right: padding.right * kx, top: padding.top * ky, bottom: padding.bottom * ky }
  const room = Math.min((W - padding.left - padding.right) / (x1 - x0 || 1e-9), (H - padding.top - padding.bottom) / (y1 - y0 || 1e-9))
  const zoom = Math.min(scene.maxZoom ?? 22, Math.log2(room / 512))
  const scale = 512 * 2 ** zoom
  // The map's centre sits off the box's centre by half the padding difference.
  const sx = (x0 + x1) / 2 - (padding.left - padding.right) / 2 / scale
  const sy = (y0 + y1) / 2 - (padding.top - padding.bottom) / 2 / scale
  const [x, y] = [sx * cos - sy * sin, sx * sin + sy * cos]
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
  return { center: [x * 360 - 180, lat], zoom, pitch: 0, bearing }
}
const WITH_PHONE = new Set(['live', 'presentation'])
// The films drawn as a story (their own layers on a quiet map), not the tour.
const STORIES = new Set(['story', 'live', 'presentation'])
// A paired real phone plays the presentation's phone: the film uses the whole width.
const paddingFor = (kind) =>
  WITH_PHONE.has(kind) && !(kind === 'presentation' && isPaired()) ? LIVE_PADDING : STORY_PADDING

// The bird's-eye camera at sim time t: straight above the van and the
// anchors (her door, the hospital) together, as close as `zoom` allows, so it
// pulls back as the van wanders off. A margin keeps them off the edges.
const ABOVE_MARGIN = 110
function birdsEyeCamera(m, { van, zoom, bearing, anchors = [] }, t, padding) {
  const st = vanState(van, t)
  if (!st) return null
  const room = Object.fromEntries(Object.entries(padding).map(([k, v]) => [k, v + ABOVE_MARGIN]))
  return frameCamera(m, { frame: [...anchors, st.pos], bearing, maxZoom: zoom }, room)
}

// Where each of a film's shots points the camera, in order: for prefetching.
function shotCameras(m, fleet, scenes, padding) {
  return scenes.flatMap((sc) => {
    if (sc.frame) return [frameCamera(m, sc, padding)]
    if (sc.pan) return [sc.pan.from, mixCamera(sc.pan.from, sc.pan.to, 0.5), sc.pan.to]
    if (sc.birdsEye) {
      return [0, 0.25, 0.5, 0.75, 1]
        .map((k) => birdsEyeCamera(m, sc.birdsEye, lerp(sc.t[0], sc.t[1], k), padding))
        .filter(Boolean)
    }
    if (sc.follow != null) {
      const van = fleet.vansById[sc.follow]
      return [0, 0.5, 1]
        .map((k) => vanState(van, lerp(sc.t[0], sc.t[1], k)))
        .filter(Boolean)
        .map((st) => ({ center: st.pos, zoom: sc.zoom, pitch: sc.pitch }))
    }
    return [sc.from, sc.to].filter(Boolean)
  })
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
  // `dirty` asks the loop to redraw once; while paused and idle it draws nothing.
  // `film` is set while a film plays: {kind, elapsed, index, snap, to, paused, done,
  // stepped, holdEnd}, kind 'film' (the directed tour) or 'story' (the minimal
  // cut). `stepped` is presenter mode: each shot holds on its last frame until
  // the presenter steps on with the arrow keys.
  const sim = useRef({ t: 0, playing: true, speed: 60, selected: null, follow: false, glide: null, camBearing: 0, dirty: true, film: null })
  const [view, setView] = useState(sim.current)
  const refresh = useCallback(() => setView({ ...sim.current }), [])
  // A change the map has to show: redraw, and update the HUD.
  const touch = useCallback(() => {
    sim.current.dirty = true
    refresh()
  }, [refresh])
  const maria = useMemo(() => fleet && mariaTrip(fleet), [fleet])
  // The presentation ride and its timeline, from the server or the bundled snapshot.
  const [pres, setPres] = useState(null)
  useEffect(() => {
    const load = () =>
      loadPresentation()
        .then(setPres)
        .catch(() => {}) // no presentation, the other films still play
    load()
    // Set up anew (a key, a paired phone): the server's ride, or the snapshot.
    window.addEventListener('leeway-setup', load)
    return () => window.removeEventListener('leeway-setup', load)
  }, [])
  const presentation = useMemo(() => fleet && pres && presentationScenes(fleet, pres), [fleet, pres])
  const films = useMemo(
    () =>
      fleet &&
      maria && {
        film: filmScenes(fleet, maria),
        story: storyScenes(fleet, maria),
        live: liveScenes(fleet),
        ...(presentation && { presentation }),
      },
    [fleet, maria, presentation],
  )
  // The key handler is bound once, so it reads the latest of these.
  const latest = useRef({})
  const getT = useCallback(() => sim.current.t, [])

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
    // For scripted rehearsals of the film in a dev build.
    if (import.meta.env.DEV) window.__leeway = { sim, map: m }
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
    // Late pickups in time order, and the marks for the film's whole-day shot,
    // one array per count so deck.gl sees new data only when a mark appears.
    const lateStops = fleet.pickups.filter((p) => p.status !== 'no_show' && !p.onTime)
    const lateMarks = new Map()
    const firstLate = (n) => {
      if (!lateMarks.has(n)) lateMarks.set(n, lateStops.slice(0, n))
      return lateMarks.get(n)
    }
    const marksFor = (at) => {
      if (at?.scene.reveal) return firstLate(revealCount(at.p, lateStops.length))
      return at?.scene.showLate ? firstLate(lateStops.length) : undefined
    }
    let posted = 0
    const frame = (now) => {
      const s = sim.current
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      const at = s.film && films ? direct(s, dt, films[s.film.kind]) : null
      // The presentation drives the server's ride (and the real phone) with its clock.
      if (at && s.film.kind === 'presentation' && now - posted >= CLOCK_MS) {
        posted = now
        presentationSync.post(s.t)
      }
      if (s.playing && !s.film) {
        s.t += (dt * s.speed) / 60
        if (s.t > fleet.meta.end) s.t = fleet.meta.start
      }
      if (at?.drawn) {
        const since = s.film.elapsed - at.start
        const shot = { scene: at.scene, since, elapsed: s.film.elapsed, t: s.t, pulse: now / 1000, zoom: map.current.getZoom() }
        let layers =
          s.film.kind === 'presentation'
            ? buildPresentationLayers({ pres: films.presentation.pres, ...shot })
            : s.film.kind === 'live'
            ? buildLiveLayers({ live: films.live.live, ...shot })
            : buildStoryLayers({
                fleet,
                maria,
                scenes: films.story,
                scene: at.scene,
                since,
                elapsed: s.film.elapsed,
                t: s.t,
                pulse: now / 1000,
              })
        if (at.scene.fleet) {
          // The whole fleet fades in as Maria's drawing fades out.
          const k = Math.min(1, (s.film.elapsed - at.start) / 1.8)
          const states = fleet.vans.map((v) => vanState(v, s.t)).filter(Boolean)
          const city = buildLayers({ fleet, t: s.t, states, selectedId: null, mariaWaiting: null, pulse: now / 1000, onPick: select })
          layers = [...layers, ...city.map((l) => l.clone({ opacity: (l.props.opacity ?? 1) * k }))]
        }
        overlay.current.setProps({ layers })
        shoot(s, at, [], dt)
      } else if (at || (!s.film && (s.playing || s.dirty || s.glide || s.turning))) {
        s.dirty = false
        const states = []
        for (const van of fleet.vans) {
          const st = vanState(van, s.t)
          if (st) states.push(st)
        }
        const mariaWaiting = maria && s.t >= maria.windowStart - 30 && s.t < maria.pickup.t ? mariaSpot : null
        const city = buildLayers({
          fleet,
          t: s.t,
          states,
          selectedId: s.selected,
          mariaWaiting,
          lateMarks: marksFor(at),
          pulse: now / 1000,
          onPick: select,
        })
        // Before a film: hidden copies of its kinds of layer, so the GPU
        // compiles their shaders now rather than part way into a shot.
        overlay.current.setProps({ layers: s.film ? city : [...city, ...warmLayers(HOME.center)] })
        s.turning = false
        if (at) shoot(s, at, states, dt)
        else {
          const st = s.follow && states.find((v) => v.id === s.selected)
          if (st) steer(s, st, fleet.vansById[st.id], dt, now)
        }
      }
      raf = requestAnimationFrame(frame)
    }

    // The film's clock: which scene is playing, and the sim time it shows.
    // Returns null once the film has finished and its last frame is drawn.
    function direct(s, dt, scenes) {
      const f = s.film
      if (f.done) return null
      if (!f.paused) f.elapsed = f.stepped ? Math.min(f.elapsed + dt, f.holdEnd ?? Infinity) : f.elapsed + dt
      // A shot waiting on the real phone call holds until the call is over,
      // unless the presenter steps on.
      const current = scenes[f.index]
      if (current?.waitForCall && !f.jumped && !liveCall.isOver()) {
        f.elapsed = Math.min(f.elapsed, f.holdEnd ?? Infinity)
      }
      f.jumped = false
      const at = sceneAt(scenes, f.elapsed)
      at.drawn = STORIES.has(f.kind)
      const newShot = at.index !== f.index
      if (newShot) {
        // A new shot starts from wherever the last one left the camera.
        const m = map.current
        const c = m.getCenter()
        f.snap = { center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }
        // Following from above straight on from the shot before: no blend in,
        // or the camera would lag the van while it caught up.
        f.wasAbove = Boolean(scenes[f.index]?.birdsEye) && at.index === f.index + 1
        f.index = at.index
        s.selected = at.scene.follow ?? null
        s.camBearing = f.snap.bearing
        // The map shows what the latest scene to set it asked for, even when
        // the story starts part way through.
        const basemap = scenes.slice(0, at.index + 1).findLast((sc) => sc.basemap)?.basemap
        if (basemap && basemap !== f.basemap) setBasemap(m, basemap, f.kind === 'film' ? undefined : 900)
        f.basemap = basemap
        if (at.scene.frame) f.to = frameCamera(m, at.scene, paddingFor(f.kind))
        // The first shot of a film (or of a seek into one) starts on its frame.
        f.cutIn = f.firstShot
        f.firstShot = false
        if (at.scene.startCall) liveCall.start(at.scene.startCall)
        // The rider says yes on the phone (the film taps it); moving past that shot says it too.
        if (at.scene.answerAsk) filmRider.answer()
        // In presenter mode the shot holds just before the next one begins.
        f.holdEnd = at.start + at.scene.dur - 0.001
        refresh() // the new caption, now rather than at the next HUD tick
      }
      s.t = lerp(at.scene.t[0], at.scene.t[1], at.scene.ease ? easeStop(at.p) : at.p)
      if (newShot && at.scene.cut && at.scene.follow != null) {
        // Cutting to a chase shot: start already behind the van.
        const van = fleet.vansById[at.scene.follow]
        s.camBearing = headingAhead(van, s.t) ?? vanState(van, s.t)?.heading ?? s.camBearing
      }
      if (f.elapsed >= filmLength(scenes) && !f.stepped) f.done = true
      return at
    }

    // Point the camera for this frame of the shot.
    function shoot(s, { scene, p, start }, states, dt) {
      const f = s.film
      const k = easeInOut(p)
      if (scene.frame) {
        map.current.jumpTo(mixCamera(scene.jump || f.cutIn ? f.to : f.snap, f.to, k))
        return
      }
      if (scene.birdsEye) {
        // Straight above the van, coming down onto it from the shot before.
        const above = birdsEyeCamera(map.current, scene.birdsEye, s.t, paddingFor(f.kind))
        if (!above) return
        const b = f.wasAbove || f.cutIn ? 1 : easeInOut(Math.min(1, (f.elapsed - start) / scene.birdsEye.blend))
        map.current.jumpTo(mixCamera(f.snap, above, b))
        return
      }
      if (scene.pan) {
        // A steady pan, which the camera eases onto from wherever it was.
        const pan = mixCamera(scene.pan.from, scene.pan.to, p)
        const onto = easeInOut(Math.min(1, (f.elapsed - start) / scene.pan.rise))
        const camera = mixCamera(f.snap, pan, onto)
        // Turn toward where the pan starts by the shorter way, then keep turning
        // with it. (The shorter way to the moving pan can flip sides half way,
        // which would swing the camera round.)
        const turn = shortestTurn(f.snap.bearing, scene.pan.from.bearing) + (pan.bearing - scene.pan.from.bearing)
        camera.bearing = f.snap.bearing + turn * onto
        map.current.jumpTo(camera)
        return
      }
      if (scene.follow == null) {
        map.current.jumpTo(mixCamera(scene.from ?? f.snap, scene.to, k))
        return
      }
      // Chase shot: behind the van, heading where the road goes. Cutting in
      // from elsewhere (`blend` seconds), the camera rises and comes down onto it.
      const st = states.find((v) => v.id === scene.follow)
      if (!st) return
      const target = headingAhead(fleet.vansById[st.id], s.t) ?? s.camBearing
      s.camBearing += shortestTurn(s.camBearing, target) * Math.min(1, dt * 2)
      const chase = {
        center: st.pos,
        bearing: s.camBearing,
        zoom: lerp(f.snap.zoom, scene.zoom, k),
        pitch: lerp(f.snap.pitch, scene.pitch, k),
      }
      if (!scene.blend) {
        map.current.jumpTo(chase)
        return
      }
      const b = easeInOut(Math.min(1, (f.elapsed - start) / scene.blend))
      const camera = mixCamera({ ...f.snap, zoom: chase.zoom, pitch: chase.pitch }, chase, b)
      camera.zoom -= 2.4 * Math.sin(Math.PI * b)
      map.current.jumpTo(camera)
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
  }, [fleet, maria, films, refresh, select])

  // ?follow=maria starts by following Maria's ride (handy for demos and kiosks).
  useEffect(() => {
    if (!fleet || new URLSearchParams(window.location.search).get('follow') !== 'maria') return
    const go = () => controls.followMaria({ instant: true })
    if (map.current.loaded()) go()
    else map.current.once('load', go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet])

  // ?film starts with the film, ?story with the story, and so on. Once: the
  // films are made again when the presentation's data arrives.
  const autoplayed = useRef(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!films || autoplayed.current) return
    if (params.has('presentation') && !films.presentation) return
    autoplayed.current = true
    // ?film=40 starts 40 seconds in, for rehearsing one shot; &present starts
    // in presenter mode.
    const stepped = params.has('present')
    if (params.has('film')) controls.playFilm(Number(params.get('film')) || 0, 'film', { stepped })
    else if (params.has('story')) controls.playFilm(Number(params.get('story')) || 0, 'story', { stepped })
    else if (params.has('live')) controls.playFilm(Number(params.get('live')) || 0, 'live', { stepped })
    else if (params.has('presentation')) {
      controls.playFilm(Number(params.get('presentation')) || 0, 'presentation', { stepped })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [films])

  // Space plays and pauses (the film too); Esc leaves the film. In a film the
  // arrow keys, and the Page Up/Down a presentation clicker sends, step
  // between shots and switch to presenter mode.
  useEffect(() => {
    const onKey = (e) => {
      const s = sim.current
      if (e.code === 'Escape' && s.film) controls.exitFilm()
      const step = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.code]
      if (step && s.film) {
        e.preventDefault()
        latest.current.controls.step(step)
      }
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        if (s.film) s.film.paused = !s.film.paused
        else s.playing = !s.playing
        touch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch])

  const controls = {
    playFilm: async (from = 0, kind = 'film', { stepped = false } = {}) => {
      const s = sim.current
      const m = map.current
      // Download every shot's tiles in order while the fonts load.
      prefetchShots(shotCameras(m, fleet, films[kind], paddingFor(kind)), {
        width: m.getContainer().clientWidth,
        height: m.getContainer().clientHeight,
        terrain: true,
      })
      await fontsReady()
      // The story starts on a blank page; the film on the full map.
      if (STORIES.has(kind)) setBasemap(m, 'blank', 0)
      else if (STORIES.has(s.film?.kind)) setBasemap(m, 'full', 0)
      liveCall.reset()
      // A fresh presentation trip on the server; the clock posts start once it's there.
      // The film's side of the ride starts fresh too (its yes, if the phone doesn't say it).
      if (kind === 'presentation') {
        presentationSync.start(pres)
        filmRider.reset(films.presentation.pres, from ? s.t : films.presentation.pres.windowStart)
      }
      s.film = {
        kind,
        elapsed: from,
        index: -1,
        snap: null,
        to: null,
        paused: false,
        done: false,
        stepped,
        holdEnd: null,
        firstShot: true,
      }
      s.follow = false
      s.glide = null
      touch()
    },
    // Presenter mode: on to the next shot (1) or back (-1). Back restarts
    // the current shot first if it's more than a moment in.
    step: (dir) => {
      const f = sim.current.film
      const scenes = films?.[f?.kind]
      if (!scenes) return
      const { index, start } = sceneAt(scenes, f.elapsed)
      const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((a, sc) => a + sc.dur, 0))
      let target = index + dir
      if (dir < 0 && f.elapsed - start > 1.2) target = index
      target = Math.max(0, Math.min(scenes.length - 1, target))
      f.elapsed = starts[target] + 0.001
      f.holdEnd = null // the new shot sets its own
      f.jumped = true // and the presenter may step past a call still running
      f.stepped = true
      f.paused = false
      f.done = false
      touch()
    },
    exitFilm: () => {
      const s = sim.current
      if (STORIES.has(s.film?.kind)) setBasemap(map.current, 'full', 900)
      liveCall.reset()
      s.film = null
      s.selected = null
      s.playing = false
      map.current.easeTo({ ...HOME, duration: 1800 })
      touch()
    },
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
    hasPresentation: Boolean(films?.presentation),
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

  latest.current.controls = controls

  return (
    <div className={view.film ? 'app filming' : 'app'}>
      <div ref={mapEl} className="map" />
      {error && <div className="error">{error}</div>}
      {fleet && !view.film && <Hud fleet={fleet} view={view} controls={controls} maria={maria} />}
      {view.film?.kind === 'film' && (
        <FilmOverlay
          fleet={fleet}
          maria={maria}
          scenes={films.film}
          view={view}
          onExit={controls.exitFilm}
          onReplay={() => controls.playFilm()}
        />
      )}
      {view.film?.kind === 'live' && (
        <LiveOverlay
          scenes={films.live}
          view={view}
          getT={getT}
          onExit={controls.exitFilm}
          onReplay={() => controls.playFilm(0, 'live')}
        />
      )}
      {view.film?.kind === 'presentation' && (
        <PresentationOverlay
          scenes={films.presentation}
          view={view}
          getT={getT}
          onExit={controls.exitFilm}
          onReplay={() => controls.playFilm(0, 'presentation')}
        />
      )}
      {view.film?.kind === 'story' && (
        <StoryOverlay
          fleet={fleet}
          maria={maria}
          scenes={films.story}
          view={view}
          onExit={controls.exitFilm}
          onReplay={() => controls.playFilm(0, 'story')}
        />
      )}
      {!fleet && !error && <div className="loading">Loading the simulated day…</div>}
    </div>
  )
}
