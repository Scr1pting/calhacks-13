// A dark, quiet MapLibre style in the spirit of Waymo's rider display, built
// only from open data, no API keys:
//   - OpenFreeMap vector tiles (OpenStreetMap data, OpenMapTiles schema) for
//     land, water, roads, labels and 3D buildings (extruded to OSM heights)
//   - AWS Terrain Tiles (open elevation data) for hillshading the East Bay hills

const ROAD = {
  service: '#20252c',
  minor: '#252a31',
  tertiary: '#2c3239',
  secondary: '#323941',
  primary: '#3a424c',
  trunk: '#414a55',
  motorway: '#4b5562',
}

const width = (z12, z18) => ['interpolate', ['exponential', 1.6], ['zoom'], 10, z12 * 0.4, 12, z12, 18, z18]

function roadLayer(id, classes, color, w12, w18, minzoom = 0) {
  return {
    id,
    type: 'line',
    source: 'osm',
    'source-layer': 'transportation',
    minzoom,
    filter: ['all', ['in', ['get', 'class'], ['literal', classes]], ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width(w12, w18) },
  }
}

export const mapStyle = {
  version: 8,
  name: 'Paramobility night',
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
    'sky-color': '#07090c',
    'horizon-color': '#18202b',
    'fog-color': '#0d1015',
    'sky-horizon-blend': 0.7,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.4,
  },
  light: { anchor: 'map', position: [1.3, 210, 40], color: '#ffffff', intensity: 0.45 },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#101318' } },
    {
      id: 'landcover',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland', 'scrub']]],
      paint: { 'fill-color': '#121814', 'fill-opacity': 0.7 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'osm',
      'source-layer': 'park',
      paint: { 'fill-color': '#121a16', 'fill-opacity': 0.8 },
    },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: {
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': '#05070a',
        'hillshade-highlight-color': '#262c35',
        'hillshade-accent-color': '#0e1116',
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'osm',
      'source-layer': 'water',
      paint: { 'fill-color': '#08101c' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'osm',
      'source-layer': 'waterway',
      paint: { 'line-color': '#0b1524', 'line-width': 1 },
    },
    {
      id: 'runway',
      type: 'fill',
      source: 'osm',
      'source-layer': 'aeroway',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#181c22' },
    },
    roadLayer('road-service', ['service', 'track'], ROAD.service, 0.4, 3, 14),
    roadLayer('road-minor', ['minor'], ROAD.minor, 0.6, 6, 12),
    roadLayer('road-tertiary', ['tertiary'], ROAD.tertiary, 0.8, 9),
    roadLayer('road-secondary', ['secondary'], ROAD.secondary, 1, 11),
    roadLayer('road-primary', ['primary'], ROAD.primary, 1.2, 13),
    roadLayer('road-trunk', ['trunk'], ROAD.trunk, 1.4, 15),
    roadLayer('road-motorway', ['motorway'], ROAD.motorway, 1.6, 17),
    {
      id: 'rail',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'rail'],
      minzoom: 12,
      paint: { 'line-color': '#262b33', 'line-width': 1, 'line-dasharray': [3, 3] },
    },
    {
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'osm',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        // Soft light-grey blocks, brighter as they get taller.
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6],
          0, '#68727d', 15, '#939da8', 60, '#c3cbd3', 150, '#e4e9ee',
        ],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, ['coalesce', ['get', 'render_height'], 6]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.88,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: 'road-names',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'transportation_name',
      minzoom: 16,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-letter-spacing': 0.04,
      },
      paint: { 'text-color': '#5d6773', 'text-halo-color': '#101318', 'text-halo-width': 1.2 },
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
        'text-size': ['match', ['get', 'class'], 'city', 13, 'town', 12, 10],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.14,
      },
      paint: {
        'text-color': ['match', ['get', 'class'], ['city', 'town'], '#c3cbd4', '#8f99a5'],
        'text-halo-color': '#0b0e12',
        'text-halo-width': 1.8,
      },
    },
  ],
}
