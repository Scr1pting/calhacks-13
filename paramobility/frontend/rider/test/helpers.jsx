import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import App from '../src/App.jsx'
import { createFakeBackend } from './fakeBackend.js'

export const RIDER_ID = 'rider_test'

// Starts the app against a fresh fake backend. `seed` runs before the app
// loads, for riders who already have trips.
export function startApp({ seed, newRider = false, backendOptions } = {}) {
  const backend = createFakeBackend(backendOptions)
  vi.stubGlobal('fetch', backend.fetch)
  vi.stubGlobal('EventSource', backend.EventSource)
  if (!newRider) localStorage.setItem('leeway.v2', JSON.stringify({ riderId: RIDER_ID, confirmations: {} }))
  seed?.(backend)
  const user = userEvent.setup()
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  return { backend, user }
}

// The phone, without the demo panel next to it.
export const phone = () => document.querySelector('.lw-phone')

// Every enabled button on screen must do something when used. React keeps a
// node's props under a `__reactProps$…` key, so this reads the real handlers.
// The top bar is the same on every screen, so it's checked on its own (pass
// it as `root`) rather than failing every screen's check.
export function expectNoDeadButtons(root = document.body) {
  const dead = [...root.querySelectorAll('button')]
    .filter((b) => !b.disabled)
    .filter((b) => root.matches('.lw-top-bar') || !b.closest('.lw-top-bar'))
    .filter((b) => {
      const key = Object.keys(b).find((k) => k.startsWith('__reactProps$'))
      const props = key ? b[key] : {}
      return !['onClick', 'onPointerDown', 'onPointerUp', 'onKeyDown'].some((h) => typeof props[h] === 'function')
    })
    .map((b) => b.getAttribute('aria-label') || b.textContent.trim() || b.className)
  expect(dead, 'buttons that do nothing').toEqual([])
}

export function expectContract(backend) {
  expect(backend.violations, 'requests that don’t match the backend API').toEqual([])
}

// An ISO time `minutes` after the faked "now" (9:00 on Nov 3, local time).
export const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString()

export { screen }
