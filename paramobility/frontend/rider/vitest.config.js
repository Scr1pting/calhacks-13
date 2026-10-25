import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}'],
    // The app reads these at import time (src/api/client.js); they point it at test/fakeBackend.js.
    env: { VITE_API_BASE: 'http://api.test', VITE_API_KEY: 'test-key', VITE_DEMO_CLINIC_PHONE: '' },
  },
})
