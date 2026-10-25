import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The live story's phone shows the rider app's real screens, and the
// presentation's phone runs the whole rider app, imported from ../rider/src.
// They resolve React and Leaflet from this app, so there is one copy of each
// (two Reacts would break hooks). In the film, the rider app talks to a stand-in
// for the server (src/film/riderApi.js) instead of its API client.
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'leaflet'],
    alias: [{ find: /^\.\.\/api\/client\.js$/, replacement: fileURLToPath(new URL('./src/film/riderApi.js', import.meta.url)) }],
  },
  server: { port: 5174, fs: { allow: ['.', '../rider/src'] } },
})
