import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// The EBP booking mock pauses for ~5 s to feel like a phone call; the tests
// skip the pauses but keep its steps.
vi.mock('../src/mocks/paratransit.js', () => ({
  requestPickupWindow: async (onStep) => {
    onStep(1)
    onStep(2)
  },
  confirmBooking: async () => '#41234',
}))

// No microphone or speakers in jsdom: a one-second recording, and audio that
// finishes playing at once.
vi.mock('../src/lib/recorder.js', () => ({
  startRecording: async () => async () => ({ blob: new Blob(['wav'], { type: 'audio/wav' }), seconds: 1.2 }),
  playAudio: (_audio, onEnd) => {
    setTimeout(onEnd, 0)
    return () => {}
  },
}))

beforeEach(() => {
  // A fixed morning, so "later today" appointments stay today. Only Date is
  // faked; timers run normally.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
