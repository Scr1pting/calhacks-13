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
      minzoom: 13,
      paint: {
        'fill-extrusion-color': '#fbfbf9',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, ['coalesce', ['get', 'render_height'], 6]],
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
