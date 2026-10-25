import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { CubeGeometry, SphereGeometry } from '@luma.gl/engine'
import { bandColor, routeAhead, stopsBetween } from '../sim/fleet.js'

// Vans are small 3D vehicles in Leeway ink with a sensor dome on the roof,
// sitting on a white model city. Meshes are unit-sized and scaled to a
// paratransit van, about 1.5x life size (meters) so they read at street zoom.
const BODY = new CubeGeometry()
const DOME = new SphereGeometry({ nlat: 12, nlong: 24 })
const VAN = { halfWidth: 1.6, halfLength: 4.3, halfHeight: 1.7 }

// Leeway tokens (frontend/rider/src/tokens.css)
const INK = [20, 22, 24]
const GREY = [107, 110, 114]
const ACCENT = [74, 59, 184]
const WHITE = [255, 255, 255]

// Draw on top of everything, not depth-tested against the road and buildings at
// the same height, which made the route flicker into dashes.
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false }

// deck.gl compares `data` by reference, so hand it the same array while the
// marker is unchanged instead of a fresh one each frame.
const NONE = []
const wrapped = new WeakMap()
const asData = (item) => {
  if (!item) return NONE
  if (!wrapped.has(item)) wrapped.set(item, [item])
  return wrapped.get(item)
}

// Each frame, new layers with the same ids: deck.gl only updates what changed.
// `pulse` is real time in seconds, so Maria's marker breathes at the same calm
// pace whatever speed the day plays at.
export function buildLayers({ fleet, t, states, selectedId, mariaWaiting, lateMarks = NONE, pulse = 0, onPick }) {
  const mariaData = asData(mariaWaiting)
  const selectedVan = selectedId != null ? fleet.vansById[selectedId] : null
  const ahead = selectedVan ? routeAhead(selectedVan, t, 50) : []
  const aheadData = ahead.length > 1 ? [{ path: ahead }] : []
  const recent = stopsBetween(fleet, t - 2.5, t).map((stop) => ({ stop, age: t - stop.t }))
  const pickable = { pickable: true, onClick: (info) => info.object && onPick(info.object.id) }

  return [
    new TripsLayer({
      id: 'trails',
      data: fleet.trails,
      getPath: (d) => d.path,
      getTimestamps: (d) => d.timestamps,
      getColor: INK,
      opacity: 0.4,
      widthMinPixels: 2,
      widthMaxPixels: 5,
      getWidth: 4,
      jointRounded: true,
      capRounded: true,
      trailLength: 6,
      currentTime: t,
    }),
    new PathLayer({
      id: 'route-ahead-casing',
      data: aheadData,
      parameters: ON_TOP,
      getPath: (d) => d.path,
      getColor: WHITE,
      getWidth: 10,
      widthMinPixels: 9,
      jointRounded: true,
      capRounded: true,
    }),
    new PathLayer({
      id: 'route-ahead',
      data: aheadData,
      parameters: ON_TOP,
      getPath: (d) => d.path,
      getColor: ACCENT,
      getWidth: 5,
      widthMinPixels: 5,
      jointRounded: true,
      capRounded: true,
    }),
    new ScatterplotLayer({
      id: 'pulses',
      data: recent,
      getPosition: (d) => d.stop.pos,
      getRadius: (d) => 20 + d.age * 60,
      radiusMinPixels: 4,
      stroked: true,
      filled: false,
      getLineColor: (d) => [...pulseColor(d.stop), Math.round(220 * (1 - d.age / 2.5))],
      lineWidthMinPixels: 2,
      updateTriggers: { getRadius: t, getLineColor: t },
    }),
    // Every late pickup so far, as it happened (the film's whole-day shot).
    new ScatterplotLayer({
      id: 'late-marks',
      data: lateMarks,
      getPosition: (d) => d.pos,
      getRadius: 70,
      radiusMinPixels: 3,
      radiusMaxPixels: 8,
      getFillColor: [217, 130, 43, 215],
      getLineColor: WHITE,
      stroked: true,
      lineWidthMinPixels: 1,
    }),
    new ScatterplotLayer({
      id: 'maria',
      data: mariaData,
      getPosition: (d) => d.pos,
      getRadius: 24 + 5 * Math.sin((pulse * 2 * Math.PI) / 2.6),
      radiusMinPixels: 7,
      getFillColor: [...ACCENT, 60],
      getLineColor: ACCENT,
      stroked: true,
      lineWidthMinPixels: 2.5,
      updateTriggers: { getRadius: pulse },
    }),
    new TextLayer({
      id: 'maria-label',
      data: mariaData,
      getPosition: (d) => d.pos,
      getText: () => 'Maria is waiting',
      getColor: ACCENT,
      getSize: 13,
      getPixelOffset: [0, -26],
      fontFamily: '"Instrument Sans", sans-serif',
      fontWeight: 600,
      background: true,
      getBackgroundColor: [236, 233, 250, 240], // --lw-accent-bg
      backgroundPadding: [8, 4],
    }),
    new ScatterplotLayer({
      id: 'halos',
      data: states,
      getPosition: (d) => d.pos,
      // A solid status dot with a white ring, so vans read at any zoom on the white city.
      getRadius: 9,
      radiusMinPixels: 5,
      radiusMaxPixels: 22,
      getFillColor: (d) => [...bandColor(d.behind), d.id === selectedId ? 170 : 220],
      getLineColor: (d) => (d.id === selectedId ? ACCENT : WHITE),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (d) => (d.id === selectedId ? 3 : 1.8),
      updateTriggers: { getFillColor: [t, selectedId], getLineColor: selectedId, getLineWidth: selectedId },
      ...pickable,
    }),
    new SimpleMeshLayer({
      id: 'van-body',
      data: states,
      mesh: BODY,
      getPosition: (d) => d.pos,
      getOrientation: (d) => [0, -d.heading, 0],
      getScale: [VAN.halfWidth, VAN.halfLength, VAN.halfHeight],
      getTranslation: [0, 0, VAN.halfHeight + 0.35],
      getColor: (d) => (d.id === selectedId ? ACCENT : INK),
      material: { ambient: 0.6, diffuse: 0.5, shininess: 40, specularColor: [200, 200, 200] },
      updateTriggers: { getColor: selectedId },
      ...pickable,
    }),
    new SimpleMeshLayer({
      id: 'van-dome',
      data: states,
      mesh: DOME,
      getPosition: (d) => d.pos,
      getOrientation: (d) => [0, -d.heading, 0],
      getScale: [0.75, 0.75, 0.55],
      getTranslation: [0, 0.9, VAN.halfHeight * 2 + 0.5],
      getColor: [236, 236, 233],
      material: { ambient: 0.6, diffuse: 0.5, shininess: 60, specularColor: [255, 255, 255] },
    }),
  ]
}

function pulseColor(stop) {
  if (stop.kind === 'D' || stop.status === 'no_show') return GREY
  return bandColor(stop.onTime ? 0 : 99)
}
