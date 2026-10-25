// The rider app end to end against the fake backend: each test walks one part
// of Denise's journey through the real <App />, clicking what a rider would
// click, and checks that the screen changes and that the right request
// reaches the backend in the shape the backend expects.

import { act, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { RIDER_ID, expectContract, expectNoDeadButtons, phone, screen, startApp } from './helpers.jsx'

const at = (h, m, day = 3) => new Date(2026, 10, day, h, m).toISOString()
const p = () => within(phone())

// A rider with today's Neurology ride booked (and Physical therapy not planned yet).
function bookedToday(backend, fields = {}) {
  return backend.seedTrip({
    rider_id: RIDER_ID,
    calendar_event_id: 'cal-neuro',
    title: 'Neurology',
    arrive_by: at(12, 30),
    status: 'booked',
    booked_pickup: at(11, 15),
    outlook: { checked_at: at(9, 0), p_on_time: 0.9, expected_arrival: at(12, 10), minutes_late: 0 },
    ...fields,
  })
}

describe('first launch', () => {
  test('syncs the rider, then shows the calendar appointments', async () => {
    const { backend } = startApp({ newRider: true })
    expect(await p().findByText('Neurology')).toBeInTheDocument()
    expect(p().getByText('Physical therapy')).toBeInTheDocument()
    const riderId = Object.keys(backend.state.riders)[0]
    expect(riderId).toMatch(/^rider_/)
    expect(backend.requests).toEqual(
      expect.arrayContaining([`PUT /riders/${riderId}`, `GET /riders/${riderId}/trips`, `GET /riders/${riderId}/messages`]),
    )
    expect(backend.state.riders[riderId].calendar.map((e) => e.id)).toEqual(['cal-neuro', 'cal-pt'])
    expect(backend.openStreams()).toContain(`/riders/${riderId}/stream`)
    expectNoDeadButtons(phone())
    expectContract(backend)
  })

  test('toggling appointments changes what gets arranged', async () => {
    const { backend, user } = startApp()
    await p().findByRole('button', { name: 'Arrange rides (2)' })
    await user.click(p().getByText('Physical therapy'))
    expect(p().getByRole('button', { name: 'Arrange rides (1)' })).toBeEnabled()
    await user.click(p().getByText('Neurology'))
    expect(p().getByRole('button', { name: 'Select an appointment' })).toBeDisabled()
    await user.click(p().getByText('Neurology'))
    await user.click(p().getByRole('button', { name: 'Arrange rides (1)' }))
    await waitFor(() => expect(backend.requests.filter((r) => r === 'POST /trips')).toHaveLength(1))
    expect(backend.bodies.find((b) => b.call === 'POST /trips').body).toMatchObject({
      title: 'Neurology',
      rider_id: RIDER_ID,
      calendar_event_id: 'cal-neuro',
      dest: '3600 Broadway, Oakland',
    })
    expectContract(backend)
  })
})

describe('planning and booking', () => {
  test('arrange, wait for the plan, confirm, book both appointments', async () => {
    const { backend, user } = startApp()
    await user.click(await p().findByRole('button', { name: 'Arrange rides (2)' }))

    // Planning runs on the backend; the app shows it working.
    expect(await p().findByText('Working out your ride.')).toBeInTheDocument()
    const [neuro, pt] = backend.tripsFor(RIDER_ID).sort((a, b) => a.arrive_by.localeCompare(b.arrive_by))
    await waitFor(() => expect(backend.openStreams()).toContain(`/trips/${neuro.id}/stream`))

    // The plan arrives on the trip's stream.
    act(() => backend.finishPlanning(neuro.id))
    expect(await p().findByText('APPOINTMENT 1 OF 2')).toBeInTheDocument()
    expect(p().getByText('92%')).toBeInTheDocument()
    expect(p().getByText('Leaves room for traffic.')).toBeInTheDocument()
    expectNoDeadButtons(phone())

    await user.click(p().getByRole('button', { name: 'Confirm' }))
    await p().findByText(/^Booked for/)
    expect(backend.bodies.find((b) => b.call === `POST /trips/${neuro.id}/book`).body).toEqual({
      pickup_time: neuro.plan === null ? expect.any(String) : neuro.plan.recommended.pickup_time,
    })
    expect(backend.trip(neuro.id).status).toBe('booked')
    expect(p().getByText('Confirmation #41234')).toBeInTheDocument()

    // On to the second appointment, still planning.
    await user.click(p().getByRole('button', { name: 'Next: Physical therapy' }))
    expect(await p().findByText('Working out your ride.')).toBeInTheDocument()
    act(() => backend.finishPlanning(pt.id))
    expect(await p().findByText('APPOINTMENT 2 OF 2')).toBeInTheDocument()
    await user.click(p().getByRole('button', { name: 'Confirm' }))
    await user.click(await p().findByRole('button', { name: 'Done' }))

    // Home: today's ride first.
    expect(await p().findByText(/Be ready downstairs at/)).toBeInTheDocument()
    expect(backend.trip(pt.id).status).toBe('booked')
    expectNoDeadButtons(phone())
    expectContract(backend)
  })

  test('a failed plan offers "Try again", which replans', async () => {
    const { backend, user } = startApp({
      seed: (b) => b.seedTrip({ rider_id: RIDER_ID, calendar_event_id: 'cal-neuro', arrive_by: at(12, 30) }),
    })
    const [trip] = backend.tripsFor(RIDER_ID)
    await p().findByText('Working out your ride.')
    await waitFor(() => expect(backend.openStreams()).toContain(`/trips/${trip.id}/stream`))
    act(() => backend.failPlanning(trip.id))
    await user.click(await p().findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(backend.requests).toContain(`POST /trips/${trip.id}/plan`))
    expect(await p().findByText('Working out your ride.')).toBeInTheDocument()
    expectContract(backend)
  })

  test('a booking error shows on screen and "Back" returns to the plan', async () => {
    const { backend, user } = startApp({
      seed: (b) => {
        const t = b.seedTrip({ rider_id: RIDER_ID, calendar_event_id: 'cal-neuro', arrive_by: at(12, 30) })
        b.finishPlanning(t.id)
        b.failNext(`POST /trips/${t.id}/book`, 409, 'Trip is not planned')
      },
    })
    await user.click(await p().findByRole('button', { name: 'Confirm' }))
    expect(await p().findByText('Trip is not planned')).toBeInTheDocument()
    await user.click(p().getByRole('button', { name: 'Back' }))
    expect(await p().findByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expectContract(backend)
  })
})

describe('home', () => {
  test('shows the booked ride from the backend', async () => {
    const { backend } = startApp({ seed: bookedToday })
    expect(await p().findByText('Be ready downstairs at 11:15.')).toBeInTheDocument()
    expect(p().getByText('90%')).toBeInTheDocument()
    expect(p().getByText('Kaiser Oakland')).toBeInTheDocument()
    expectNoDeadButtons(phone())
    expectContract(backend)
  })

  test('"Plan" on the unplanned appointment creates its trip', async () => {
    const { backend, user } = startApp({ seed: bookedToday })
    expect(await p().findByText(/Physical therapy/)).toBeInTheDocument()
    await user.click(p().getByRole('button', { name: 'Plan' }))
    await waitFor(() => expect(backend.tripsFor(RIDER_ID).some((t) => t.calendar_event_id === 'cal-pt')).toBe(true))
    expect(await p().findByText('Working out your ride.')).toBeInTheDocument()
    expectContract(backend)
  })

  test('a trip Leeway schedules in chat shows up with "Review"', async () => {
    const { backend, user } = startApp({ seed: bookedToday })
    await p().findByText('Be ready downstairs at 11:15.')
    let dentist
    act(() => {
      dentist = backend.scheduleFromChat(RIDER_ID, { title: 'Dentist', arrive_by: at(15, 0, 6) })
    })
    await waitFor(() => expect(backend.openStreams()).toContain(`/trips/${dentist.id}/stream`))
    act(() => backend.finishPlanning(dentist.id))
    await user.click(await p().findByRole('button', { name: 'Review' }))
    expect(await p().findByText(/For dentist on/)).toBeInTheDocument()
    expectContract(backend)
  })

  test('every booked ride on a later day shows on the everyday screen', async () => {
    const { backend } = startApp({
      seed: (b) => {
        bookedToday(b, { arrive_by: at(14, 0, 5), booked_pickup: at(12, 45, 5), calendar_event_id: 'cal-pt', title: 'Physical therapy' })
        bookedToday(b, { arrive_by: at(10, 0, 7), booked_pickup: at(8, 45, 7), calendar_event_id: '', title: 'Dentist' })
      },
    })
    expect(await p().findByText('Your rides are taken care of.')).toBeInTheDocument()
    expect(p().getByText('Also booked')).toBeInTheDocument()
    expect(p().getByText('Dentist')).toBeInTheDocument()
    expectNoDeadButtons(phone())
    expectContract(backend)
  })

  test('"Book a ride yourself" leads somewhere a ride can be booked', async () => {
    const { user } = startApp({
      seed: (b) => {
        for (const [cal, day] of [['cal-neuro', 3], ['cal-pt', 5]]) {
          bookedToday(b, {
            calendar_event_id: cal, status: 'completed', arrive_by: at(10, 0, day - 7),
            live: { van_eta: null, picked_up_at: null, arrived_at: at(9, 50, day - 7) },
          })
        }
      },
    })
    await user.click(await p().findByRole('button', { name: 'Book a ride yourself' }))
    // Whatever it opens, the screen itself (not just the chat bar) must offer
    // something enabled to start a booking with.
    const content = within(document.querySelector('.lw-content'))
    const enabled = [...content.queryAllByRole('button'), ...content.queryAllByRole('checkbox')].filter(
      (el) => !el.disabled,
    )
    expect(enabled.map((el) => el.textContent), 'enabled controls on the screen it opens').not.toEqual([])
  })
})

describe('late ride: the call to the clinic', () => {
  async function onCall(result, transcript = []) {
    const app = startApp({ seed: bookedToday })
    const [trip] = app.backend.tripsFor(RIDER_ID)
    await p().findByText('Be ready downstairs at 11:15.')
    await waitFor(() => expect(app.backend.openStreams()).toContain(`/trips/${trip.id}/stream`))
    act(() => app.backend.startLateCall(trip.id, 25))
    expect(await p().findByText('You may be 25 minutes late.')).toBeInTheDocument()
    expect(p().getByText('Waiting for: the front desk to pick up.')).toBeInTheDocument()
    act(() => app.backend.callProgress(trip.id, [{ role: 'agent', text: 'Hi, I’m calling for Denise Carter.' }]))
    expect(await p().findByText('Hi, I’m calling for Denise Carter.')).toBeInTheDocument()
    expectNoDeadButtons(phone())
    act(() => app.backend.endLateCall(trip.id, result, transcript))
    return { ...app, trip }
  }

  test('clinic still sees her: outcome, transcript, back home', async () => {
    const { backend, user } = await onCall({ appointment_held: true, notes: 'They’ll hold the slot.' }, [
      { role: 'agent', text: 'Can she still come?' },
      { role: 'callee', text: 'Yes, we’ll hold it.' },
    ])
    expect(await p().findByText('Kaiser can still see you.')).toBeInTheDocument()
    expect(p().getByText('They’ll hold the slot.')).toBeInTheDocument()
    await user.click(p().getByRole('button', { name: 'Hear the call' }))
    expect(p().getByText('Yes, we’ll hold it.')).toBeInTheDocument()
    await user.click(p().getByRole('button', { name: 'Hide the call' }))
    expect(p().queryByText('Yes, we’ll hold it.')).not.toBeInTheDocument()
    expectNoDeadButtons(phone())
    await user.click(p().getByRole('button', { name: 'Back to my ride' }))
    expect(await p().findByText('Be ready downstairs at 11:15.')).toBeInTheDocument()
    expectContract(backend)
  })

  test('clinic can’t: every decision option does what it says', async () => {
    const { backend, user } = await onCall({ appointment_held: false, notes: 'They offered 3:30.' })
    expect(await p().findByText('Kaiser can’t see you late today.')).toBeInTheDocument()
    expect(p().getByText('They offered 3:30.')).toBeInTheDocument()
    expectNoDeadButtons(phone())

    // Each option changes the main button to match.
    await user.click(p().getByText('Talk it through with me'))
    expect(p().getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
    await user.click(p().getByText('Keep today’s ride'))
    expect(p().getByRole('radio', { name: /Keep today’s ride/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(p().getByText('Take the time they offered'))

    // "Confirm" asks Leeway (through the chat) to take the offered time.
    await user.click(p().getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(backend.requests).toContain(`POST /riders/${RIDER_ID}/messages`))
    expect(backend.bodies.find((b) => b.call === `POST /riders/${RIDER_ID}/messages`).body.text).toMatch(
      /Kaiser Oakland I’ll take the time they offered/,
    )
    expect(await p().findByText(/Reply to: Please tell Kaiser Oakland/)).toBeInTheDocument()
    expectContract(backend)
  })

  test('"Keep today’s ride" goes home', async () => {
    const { user } = await onCall({ appointment_held: false })
    await user.click(await p().findByText('Keep today’s ride'))
    await user.click(p().getByRole('button', { name: 'Keep today’s ride' }))
    expect(await p().findByText('Be ready downstairs at 11:15.')).toBeInTheDocument()
  })

  test('no answer: says it couldn’t confirm', async () => {
    await onCall(null)
    expect(await p().findByText('I couldn’t confirm with Kaiser.')).toBeInTheDocument()
  })

  test('appointment moved: shows the new time', async () => {
    const { backend } = startApp({ seed: bookedToday })
    const [trip] = backend.tripsFor(RIDER_ID)
    await p().findByText('Be ready downstairs at 11:15.')
    await waitFor(() => expect(backend.openStreams()).toContain(`/trips/${trip.id}/stream`))
    act(() => backend.moveAppointment(trip.id, at(13, 30)))
    expect(await p().findByText('Rescheduled')).toBeInTheDocument()
    expect(p().getByText('Kaiser moved you to 1:30 PM.')).toBeInTheDocument()
    expectContract(backend)
  })
})

describe('talking to Leeway', () => {
  test('open chat, use a suggestion, type, send, go back', async () => {
    const { backend, user } = startApp({ seed: bookedToday })
    await p().findByText('Be ready downstairs at 11:15.')
    await user.click(p().getByRole('button', { name: 'Ask Leeway' }))
    expect(await p().findByText('What can I help with?')).toBeInTheDocument()
    expectNoDeadButtons(phone())

    await user.click(p().getByRole('button', { name: /What’s coming up for me\?/ }))
    expect(await p().findByText('Reply to: What’s coming up for me?')).toBeInTheDocument()

    await user.type(p().getByRole('textbox', { name: 'Message Leeway' }), 'When should I be ready?{Enter}')
    expect(await p().findByText('Reply to: When should I be ready?')).toBeInTheDocument()
    expect(p().getByRole('textbox', { name: 'Message Leeway' })).toHaveValue('')

    await user.type(p().getByRole('textbox', { name: 'Message Leeway' }), 'Thanks')
    await user.click(p().getByRole('button', { name: 'Send' }))
    expect(await p().findByText('Reply to: Thanks')).toBeInTheDocument()

    await user.click(p().getByRole('button', { name: 'Back' }))
    expect(await p().findByText('Be ready downstairs at 11:15.')).toBeInTheDocument()
    expectContract(backend)
  })

  test('the conversation loads on start and Leeway’s notices arrive live', async () => {
    const { backend, user } = startApp({
      seed: (b) => {
        bookedToday(b)
        b.agentNotice(RIDER_ID, 'Your plan for neurology is ready.')
      },
    })
    await p().findByText('Be ready downstairs at 11:15.')
    await user.click(p().getByRole('button', { name: 'Ask Leeway' }))
    expect(await p().findByText('Your plan for neurology is ready.')).toBeInTheDocument()
    act(() => backend.agentNotice(RIDER_ID, 'I called Kaiser Oakland.'))
    expect(await p().findByText('I called Kaiser Oakland.')).toBeInTheDocument()
    expectContract(backend)
  })

  test('hold the mic: recording goes to the backend, the reply is spoken', async () => {
    const { backend, user } = startApp({ seed: bookedToday })
    await p().findByText('Be ready downstairs at 11:15.')
    const mic = p().getByRole('button', { name: 'Hold to talk to Leeway' })
    await user.pointer({ keys: '[MouseLeft>]', target: mic })
    await user.pointer({ keys: '[/MouseLeft]', target: mic })
    expect(await p().findByText('At 2:30.')).toBeInTheDocument()
    await waitFor(() => expect(backend.requests).toEqual(expect.arrayContaining([`POST /riders/${RIDER_ID}/voice`, 'POST /speech'])))
    expect(backend.bodies.find((b) => b.call === 'POST /speech').body).toEqual({ text: 'At 2:30.' })
    await waitFor(() => expect(p().getByRole('button', { name: 'Hold to talk to Leeway' })).not.toHaveAttribute('aria-pressed', 'true'))
    expectContract(backend)
  })

  test('a failed request shows an error the rider can dismiss', async () => {
    const { backend, user } = startApp({ seed: bookedToday })
    await p().findByText('Be ready downstairs at 11:15.')
    backend.failNext(`POST /riders/${RIDER_ID}/messages`, 503, 'Leeway is busy')
    await user.click(p().getByRole('button', { name: 'Ask Leeway' }))
    await user.click(await p().findByRole('button', { name: /When should I be ready\?/ }))
    expect(await p().findByRole('alert')).toHaveTextContent('Leeway is busy')
    await user.click(p().getByRole('button', { name: 'Dismiss' }))
    expect(p().queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('demo panel', () => {
  const panel = () => within(document.querySelector('.lw-demo-panel'))

  test('simulate buttons send real ride updates', async () => {
    const { backend, user } = startApp({ seed: bookedToday })
    const [trip] = backend.tripsFor(RIDER_ID)
    await p().findByText('Be ready downstairs at 11:15.')
    expectNoDeadButtons(document.querySelector('.lw-demo-panel'))

    await user.click(panel().getByRole('button', { name: 'Van is 40 min late' }))
    await waitFor(() => expect(backend.trip(trip.id).live.van_eta).toBeTruthy())
    await user.click(panel().getByRole('button', { name: 'Picked up on time' }))
    expect(await p().findByText('You’re on your way.')).toBeInTheDocument()
    expect(panel().getByText('riding')).toBeInTheDocument()
    await user.click(panel().getByRole('button', { name: 'Arrived' }))
    await waitFor(() => expect(backend.trip(trip.id).status).toBe('completed'))

    const statuses = backend.bodies.filter((b) => b.call === `POST /trips/${trip.id}/status`).map((b) => b.body.kind)
    expect(statuses).toEqual(['van_eta', 'picked_up', 'arrived'])
    expectContract(backend)
  })

  test('simulate buttons are off without a booked ride', async () => {
    startApp()
    await p().findByText('Neurology')
    expect(panel().getByRole('button', { name: 'Arrived' })).toBeDisabled()
  })

  test('"Start over" starts a new rider', async () => {
    const { backend, user } = startApp({ seed: bookedToday })
    await p().findByText('Be ready downstairs at 11:15.')
    await user.click(panel().getByRole('button', { name: 'Start over' }))
    expect(await p().findByText('Neurology')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('leeway.v2')).riderId).not.toBe(RIDER_ID)
    expectContract(backend)
  })
})

describe('chrome', () => {
  test('the menu button opens something', async () => {
    startApp({ seed: bookedToday })
    await p().findByText('Be ready downstairs at 11:15.')
    expectNoDeadButtons(document.querySelector('.lw-top-bar'))
  })
})

// Keep `screen` imported for debugging: screen.debug() prints the DOM.
void screen
