// Warm the browser's cache with what a film will show before it shows it:
// the map tiles under every shot's camera, in shot order (so the next shot
// is always first in line), and the fonts deck.gl draws labels with. The map
// then finds each tile already downloaded as the camera arrives, instead of
// drawing the city in as it loads.

import { mapStyle } from '../map/style.js'

const PARALLEL = 6
const VECTOR_TILE = 512 // MapLibre's tile size, in pixels
const TERRAIN = mapStyle.sources.terrain

let vector = null // {template, maxzoom} from the source's TileJSON
const requested = new Set()
const queue = []
let running = 0

async function vectorSource() {
  if (!vector) {
    vector = fetch(mapStyle.sources.osm.url)
      .then((r) => r.json())
      .then((tj) => ({ template: tj.tiles[0], maxzoom: tj.maxzoom ?? 14 }))
      .catch(() => null)
  }
  return vector
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const url = queue.shift()
    running += 1
    fetch(url)
      .catch(() => {})
      .finally(() => {
        running -= 1
        pump()
      })
  }
}

function request(url) {
  if (requested.has(url)) return
  requested.add(url)
  queue.push(url)
}

const tileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z)
function tileY(lat, z) {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

// Every tile at zoom z within `radius` pixels (at the camera's zoom) of its centre.
function tilesAround(cam, radiusPx, z) {
  const degrees = (radiusPx * 360) / (VECTOR_TILE * 2 ** cam.zoom)
  const [lng, lat] = cam.center
  const latSpan = degrees * Math.cos((lat * Math.PI) / 180)
  const out = []
  for (let x = tileX(lng - degrees, z); x <= tileX(lng + degrees, z); x += 1) {
    for (let y = tileY(lat + latSpan, z); y <= tileY(lat - latSpan, z); y += 1) out.push([z, x, y])
  }
  return out
}

const fill = (template, [z, x, y]) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y)

// Queue the tiles for these cameras ({center, zoom, pitch}), in order.
// `terrain` adds the hillshade's elevation tiles (the full map only).
export async function prefetchShots(cameras, { width, height, terrain = false }) {
  const source = await vectorSource()
  if (!source) return
  const half = Math.hypot(width, height) / 2
  for (const cam of cameras) {
    // A tilted camera sees much further toward the horizon.
    const radius = half * (1 + 2 * Math.sin(((cam.pitch ?? 0) * Math.PI) / 180))
    const z = Math.max(0, Math.min(source.maxzoom, Math.floor(cam.zoom)))
    for (const tile of [...tilesAround(cam, radius, z), ...tilesAround(cam, radius, Math.max(0, z - 1))]) {
      request(fill(source.template, tile))
    }
    if (terrain) {
      const tz = Math.max(0, Math.min(TERRAIN.maxzoom, Math.floor(cam.zoom) + 1))
      for (const tile of tilesAround(cam, radius, tz)) request(fill(TERRAIN.tiles[0], tile))
    }
  }
  pump()
}

// The faces deck.gl renders labels in and the captions use. deck.gl draws a
// label's glyphs once, so a font that arrives late would stay a fallback.
const FACES = ['600 16px "Instrument Sans"', '500 16px "Instrument Sans"', '400 48px "Instrument Serif"']
let fonts = null
export function fontsReady(timeoutMs = 1500) {
  if (!fonts) fonts = Promise.all(FACES.map((f) => document.fonts?.load(f))).catch(() => {})
  return Promise.race([fonts, new Promise((r) => setTimeout(r, timeoutMs))])
}
