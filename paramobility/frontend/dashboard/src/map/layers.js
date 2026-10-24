import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { CubeGeometry, SphereGeometry } from '@luma.gl/engine'
import { bandColor, routeAhead, stopsBetween } from '../sim/fleet.js'

// Vans are drawn as minimal 3D vehicles: a pale body with a dark sensor dome on
// the roof. The meshes are unit-sized and scaled to a paratransit van, about
// 1.5x life size (meters) so vans still read at street zoom.
const BODY = new CubeGeometry()
const DOME = new SphereGeometry({ nlat: 12, nlong: 24 })
const VAN = { halfWidth: 1.6, halfLength: 4.3, halfHeight: 1.7 }

const TEAL = [52, 227, 199]
const ROUTE_BLUE = [96, 170, 255]
const DROP_VIOLET = [167, 139, 250]
const MARIA_PINK = [255, 122, 198]

// Each frame, new layers with the same ids: deck.gl only updates what changed.
export function buildLayers({ fleet, t, states, selectedId, mariaWaiting, onPick }) {
  const selectedVan = selectedId != null ? fleet.vansById[selectedId] : null
  const ahead = selectedVan ? routeAhead(selectedVan, t, 50) : []
  const recent = stopsBetween(fleet, t - 2.5, t).map((stop) => ({ stop, age: t - stop.t }))
  const pickable = { pickable: true, onClick: (info) => info.object && onPick(info.object.id) }

  return [
    new TripsLayer({
      id: 'trails',
      data: fleet.trails,
      getPath: (d) => d.path,
      getTimestamps: (d) => d.timestamps,
      getColor: (d) => (d.id === selectedId ? ROUTE_BLUE : TEAL),
      opacity: 0.75,
      widthMinPixels: 2,
      widthMaxPixels: 6,
      getWidth: 4,
      jointRounded: true,
      capRounded: true,
      trailLength: 7,
      currentTime: t,
      updateTriggers: { getColor: selectedId },
    }),
    new PathLayer({
      id: 'route-ahead-glow',
      data: ahead.length > 1 ? [{ path: ahead }] : [],
      getPath: (d) => d.path,
      getColor: [...ROUTE_BLUE, 60],
      getWidth: 14,
      widthMinPixels: 10,
      jointRounded: true,
      capRounded: true,
    }),
    new PathLayer({
      id: 'route-ahead',
      data: ahead.length > 1 ? [{ path: ahead }] : [],
      getPath: (d) => d.path,
      getColor: [...ROUTE_BLUE, 235],
      getWidth: 5,
      widthMinPixels: 4,
      jointRounded: true,
      capRounded: true,
    }),
    new ScatterplotLayer({
      id: 'pulses',
      data: recent,
      getPosition: (d) => d.stop.pos,
      getRadius: (d) => 20 + d.age * 70,
      radiusMinPixels: 4,
      stroked: true,
      filled: false,
      getLineColor: (d) => [...pulseColor(d.stop), Math.round(255 * (1 - d.age / 2.5))],
      lineWidthMinPixels: 2,
      updateTriggers: { getRadius: t, getLineColor: t },
    }),
    new ScatterplotLayer({
      id: 'maria',
      data: mariaWaiting ? [mariaWaiting] : [],
      getPosition: (d) => d.pos,
      getRadius: 30 + 12 * Math.sin(t * 6),
      radiusMinPixels: 6,
      getFillColor: [...MARIA_PINK, 90],
      getLineColor: MARIA_PINK,
      stroked: true,
      lineWidthMinPixels: 2,
      updateTriggers: { getRadius: t },
    }),
    new TextLayer({
      id: 'maria-label',
      data: mariaWaiting ? [mariaWaiting] : [],
      getPosition: (d) => d.pos,
      getText: () => 'MARIA · WAITING',
      getColor: MARIA_PINK,
      getSize: 12,
      getPixelOffset: [0, -24],
      fontFamily: 'Inter, sans-serif',
      fontWeight: 600,
      characterSet: 'auto',
      outlineWidth: 3,
      outlineColor: [12, 14, 18],
      fontSettings: { sdf: true },
    }),
    new ScatterplotLayer({
      id: 'halos',
      data: states,
      getPosition: (d) => d.pos,
      getRadius: 9,
      radiusMinPixels: 3.5,
      radiusMaxPixels: 26,
      getFillColor: (d) => [...bandColor(d.behind), d.id === selectedId ? 120 : 70],
      getLineColor: (d) => (d.id === selectedId ? [255, 255, 255] : bandColor(d.behind)),
      stroked: true,
      lineWidthMinPixels: 1.2,
      getLineWidth: (d) => (d.id === selectedId ? 2.5 : 1),
      lineWidthUnits: 'pixels',
      updateTriggers: { getFillColor: [t, selectedId], getLineColor: [t, selectedId], getLineWidth: selectedId },
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
      getColor: (d) => (d.id === selectedId ? [255, 255, 255] : [226, 231, 236]),
      material: { ambient: 0.55, diffuse: 0.6, shininess: 40, specularColor: [255, 255, 255] },
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
      getColor: [28, 32, 38],
      material: { ambient: 0.4, diffuse: 0.5, shininess: 80, specularColor: [190, 210, 230] },
    }),
  ]
}

function pulseColor(stop) {
  if (stop.kind === 'D') return DROP_VIOLET
  if (stop.status === 'no_show') return [140, 148, 160]
  return stop.onTime ? TEAL : [255, 99, 120]
}

export const COLORS = { TEAL, ROUTE_BLUE, DROP_VIOLET, MARIA_PINK }
