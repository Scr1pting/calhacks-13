// A light MapLibre style in the Leeway look (the rider app's tokens): a white
// architectural-model city on warm grey, white roads, soft green parks. Built
// only from open data, no API keys:
//   - OpenFreeMap vector tiles (OpenStreetMap data, OpenMapTiles schema) for
//     land, water, roads, labels and 3D buildings (extruded to OSM heights)
//   - AWS Terrain Tiles (open elevation data) for hillshading the East Bay hills

const LAND = '#ededeb' // --lw-map-bg
const WATER = '#dde4ea'
const GREEN = '#dde9de' // --lw-map-green-patch
const ROAD = '#ffffff' // --lw-map-road
const CASING = '#e1e0dc' // --lw-border-secondary
const TEXT = '#6b6e72' // --lw-text-secondary

// Very soft pastels for buildings, each barely off white and drawn from the
// Leeway palette: warm creams for the warm grey, sage from the parks, mist from
// the water, lavender from the accent background.
const CREAM = '#f6efe4'
const SAND = '#f1ece2'
const PASTELS = [
  '#f3e9e5', // blush
  '#e8efe7', // sage
  '#e6ecf1', // mist blue
  '#ebe8f2', // lavender
  CREAM,
]

// The tiles carry no building ids, so colour follows height. Low-rise housing
// (mostly one default height) stays in two warm neutrals, a calm field;
// taller buildings get the pastel range, so downtown has the colour.
const height = ['coalesce', ['get', 'render_height'], 6]
const pick = (n) => ['%', ['floor', ['*', height, 7]], n]
const buildingColor = [
  'case',
  ['<', height, 12],
  ['match', pick(2), 0, CREAM, SAND],
  ['match', pick(PASTELS.length), ...PASTELS.slice(0, -1).flatMap((c, i) => [i, c]), PASTELS.at(-1)],
]

const width = (z12, z18) => ['interpolate', ['exponential', 1.6], ['zoom'], 10, z12 * 0.4, 12, z12, 18, z18]

function roads(id, classes, w12, w18, minzoom = 0) {
  const filter = ['all', ['in', ['get', 'class'], ['literal', classes]], ['!=', ['get', 'brunnel'], 'tunnel']]
  const base = { type: 'line', source: 'osm', 'source-layer': 'transportation', minzoom, filter }
  const layout = { 'line-cap': 'round', 'line-join': 'round' }
  return [
    { ...base, id: `${id}-casing`, layout, paint: { 'line-color': CASING, 'line-width': width(w12 + 1, w18 + 2) } },
    { ...base, id, layout, paint: { 'line-color': ROAD, 'line-width': width(w12, w18) } },
  ]
}

export const mapStyle = {
  version: 8,
  name: 'Leeway day',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution:
        '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    terrain: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 14,
      attribution: '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (Mapzen, AWS)',
    },
  },
  sky: {
    'sky-color': '#f5f5f3',
    'horizon-color': '#e8e7e2',
    'fog-color': '#efeeea',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.35,
  },
  light: { anchor: 'map', position: [1.4, 215, 35], color: '#ffffff', intensity: 0.32 },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': LAND } },
    {
      id: 'landcover',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'scrub']]],
      paint: { 'fill-color': GREEN, 'fill-opacity': 0.55 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'osm',
      'source-layer': 'park',
      paint: { 'fill-color': GREEN, 'fill-opacity': 0.85 },
    },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: {
        'hillshade-exaggeration': 0.22,
        'hillshade-shadow-color': '#b9b8b4',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#d6d5d0',
      },
    },
    { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water', paint: { 'fill-color': WATER } },
    {
      id: 'runway',
      type: 'fill',
      source: 'osm',
      'source-layer': 'aeroway',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#e4e3df' },
    },
    ...roads('road-minor', ['minor', 'service'], 0.6, 6, 13),
    ...roads('road-mid', ['tertiary', 'secondary'], 0.9, 10),
    ...roads('road-major', ['primary', 'trunk'], 1.2, 13),
    ...roads('road-motorway', ['motorway'], 1.5, 16),
    {
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'osm',
      'source-layer': 'building',
      // From zoom 14 only: further out there are far too many to draw smoothly.
      minzoom: 14,
      paint: {
        'fill-extrusion-color': buildingColor,
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.5, ['coalesce', ['get', 'render_height'], 6]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.96,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: 'places',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb']]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['match', ['get', 'class'], 'city', 13, 'town', 12, 11],
        'text-letter-spacing': 0.08,
        'text-transform': 'uppercase',
      },
      paint: { 'text-color': TEXT, 'text-halo-color': LAND, 'text-halo-width': 1.6 },
    },
  ],
}

// How much of the base map shows, for the story's blank-page look. Each level
// gives a layer's opacity; anything not listed is hidden. `full` is the style.
const ROADS = ['road-minor', 'road-mid', 'road-major', 'road-motorway'].flatMap((id) => [id, `${id}-casing`])
const FULL = {
  background: LAND,
  landcover: 0.55,
  park: 0.85,
  hillshade: 0.22,
  water: 1,
  runway: 1,
  buildings: 0.96,
  places: 1,
  ...Object.fromEntries(ROADS.map((id) => [id, 1])),
}
const LEVELS = {
  full: FULL,
  blank: { background: '#f5f5f3' },
  water: { background: '#f5f5f3', water: 0.4 },
  streets: { background: '#f5f5f3', water: 0.55, park: 0.4, ...Object.fromEntries(ROADS.map((id) => [id, 0.75])) },
}
const PROP = {
  background: 'background-color',
  hillshade: 'hillshade-exaggeration',
  buildings: 'fill-extrusion-opacity',
  places: 'text-opacity',
  ...Object.fromEntries(ROADS.map((id) => [id, 'line-opacity'])),
}

export function setBasemap(map, level, ms = 1400) {
  const values = LEVELS[level]
  const apply = () => {
    for (const id of Object.keys(FULL)) {
      const prop = PROP[id] ?? 'fill-opacity'
      const value = values[id] ?? (id === 'background' ? LAND : 0)
      map.setPaintProperty(id, `${prop}-transition`, { duration: ms, delay: 0 })
      map.setPaintProperty(id, prop, value)
    }
  }
  // Before the style has loaded, try again shortly.
  const go = () => {
    try {
      apply()
    } catch {
      setTimeout(go, 150)
    }
  }
  go()
}
