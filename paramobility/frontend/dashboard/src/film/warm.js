import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'

// Some GPUs (Intel on Direct3D, through ANGLE) compile a layer's shaders the
// first time a layer of that kind draws something, and take over a second
// doing it, with the whole page frozen. The films' layers often draw nothing
// until part way in (the van's path, the first label), so that freeze would
// land in the middle of a shot. These hidden copies of every kind of layer
// the films draw go on the map while it idles before a film, so the compiling
// happens there.

// The glyphs the films' labels use, so their font texture is made once, up
// front, rather than again when a label with a new character appears.
export const LABEL_CHARS = (() => {
  let s = ''
  for (let c = 32; c < 127; c += 1) s += String.fromCharCode(c)
  return `${s}·’–—…`
})()

export const DASHED = new PathStyleExtension({ dash: true })
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false }
const HIDDEN = [0, 0, 0, 0]

const cache = new Map()
export function warmLayers([lng, lat]) {
  const key = `${lng},${lat}`
  if (cache.has(key)) return cache.get(key)
  const path = [{ path: [[lng, lat], [lng + 0.001, lat + 0.001]] }]
  const dot = [{ pos: [lng, lat], text: 'Leeway · 11:52' }]
  const layers = [
    new PathLayer({ id: 'warm-path', data: path, getPath: (d) => d.path, getColor: HIDDEN, getWidth: 2, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: ON_TOP }),
    new PathLayer({ id: 'warm-dash', data: path, getPath: (d) => d.path, getColor: HIDDEN, getWidth: 2, widthUnits: 'pixels', getDashArray: [5, 4], dashJustified: true, extensions: [DASHED], parameters: ON_TOP }),
    new ScatterplotLayer({ id: 'warm-dot', data: dot, getPosition: (d) => d.pos, getRadius: 4, radiusUnits: 'pixels', stroked: true, getFillColor: HIDDEN, getLineColor: HIDDEN, parameters: ON_TOP }),
    new TextLayer({
      id: 'warm-text',
      data: dot,
      getPosition: (d) => d.pos,
      getText: (d) => d.text,
      getSize: 13,
      getColor: HIDDEN,
      background: true,
      getBackgroundColor: HIDDEN,
      fontFamily: '"Instrument Sans", sans-serif',
      fontWeight: 600,
      characterSet: LABEL_CHARS,
      parameters: ON_TOP,
    }),
  ]
  cache.set(key, layers)
  return layers
}
