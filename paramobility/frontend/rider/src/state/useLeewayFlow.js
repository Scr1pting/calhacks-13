import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, API_BASE, streamRider, streamTrip } from '../api/client.js'
import { DEMO_CLINIC_PHONE, RIDER, calendarEntries } from '../mocks/calendar.js'
import { confirmBooking, requestPickupWindow } from '../mocks/paratransit.js'
import { playAudio, startRecording } from '../lib/recorder.js'
import { TIME_ZONE, addMinutes, clock, isToday, oddsColor, percent, shortDate, toLocalISO, weekday } from '../lib/time.js'
import { DESTINATION, milesBetween, routeAt } from '../lib/liveRoute.js'

// The rider app's logic, backed by the Paramobility API. Screens stay
// presentational: this hook turns the rider's trips, activity events and
// conversation with Leeway into the view objects they render. The calendar
// entries (Leeway's backend decides with Haiku which need a ride)
// and the EBP booking call are mocks (src/mocks); everything else is the real
// backend, including talking to Leeway by voice.

const WINDOW_MINUTES = 30 // EBP pickup windows are 30 minutes long
const STORAGE_KEY = 'leeway.v2'
const ACTIVE = ['booked', 'riding']
const WAITING = ['planning', 'planned', 'failed']

const newRiderId = () => `rider_${Math.random().toString(36).slice(2, 12)}`

// The rider profile the backend keeps: who they are and where pickups start.
// Their calendar is synced separately (api.syncCalendar).
function riderProfile(callPhone) {
  return {
    name: RIDER.name,
    home: RIDER.home,
    time_zone: TIME_ZONE,
    permissions: { may_call_appointment: !!callPhone, share_rider_name: true, max_calls: 3 },
  }
}

// A calendar event the backend kept as needing a ride, in the shape the screens use.
const appointmentOf = (e) => ({
  id: e.id,
  title: e.title,
  start: new Date(e.start),
  location: { name: e.place_name, address: e.place_address, phone: e.place_phone },
})

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch {
    return {}
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // private mode: the demo still works, it just forgets on reload
  }
}

function pendingTask(label, done, doneLabel, active) {
  return { label: done ? doneLabel : label, state: done ? 'done' : active ? 'active' : 'pending' }
}

const lastOf = (events, kind, callKind) =>
  [...events].reverse().find((e) => e.kind === kind && (!callKind || e.data.call_kind === callKind))

const firstWord = (name) => name.split(' ')[0]
// What the appointment is for ("Neurology"); older trips may not have it.
const titleOf = (trip) => trip.title || 'Appointment'

const INIT = {
  screen: 'loading',
  sel: {},
  queue: [],
  qi: 0,
  booking: null, // {tripId, step, confirmation, error}
  callTripId: null,
  outcome: null, // {tripId, kind: held | moved | unclear, was}
  decision: { tripId: null, choice: 'offer' },
  pending: null, // {queue, qi} of a recommendation we're waiting to become ready
  preview: null, // 'call' | 'outcome' | 'decision' — demo-panel preview, no real trip needed
  showTranscript: false,
  back: 'home',
  voice: 'idle', // idle | listening | thinking | speaking
  draft: '',
  sending: false,
  error: '',
}

export function useLeewayFlow() {
  const [s, setS] = useState(INIT)
  // The demo menu's graveyard (every screen besides the real home) stays
  // collapsed until someone explicitly asks for it.
  const [graveyardOpen, setGraveyardOpen] = useState(false)
  // The calendar appointments that need a ride (the backend asks Haiku), and
  // how many entries didn't.
  const [appointments, setAppointments] = useState([])
  const [skipped, setSkipped] = useState(0)
  const [saved, setSaved] = useState(() => {
    const data = { confirmations: {}, callPhone: DEMO_CLINIC_PHONE, ...loadSaved() }
    if (!data.riderId) {
      data.riderId = newRiderId()
      save(data)
    }
    return data
  })
  const riderId = saved.riderId
  // The number Leeway calls as "the clinic": set in the demo panel.
  const callPhone = saved.callPhone || ''
  const calendar = useMemo(
    () => appointments.map((a) => ({ ...a, location: { ...a.location, phone: callPhone } })),
    [appointments, callPhone],
  )
  const voiceRef = useRef({ stop: null, stopAudio: null, starting: false, released: false })
  // The rider the backend knows about: its stream 404s until the profile is saved.
  const [syncedRider, setSyncedRider] = useState(null)
  const [trips, setTrips] = useState({})
  const [events, setEvents] = useState({})
  const [messages, setMessages] = useState({})
  const [now, setNow] = useState(Date.now())
  const tripsRef = useRef(trips)
  tripsRef.current = trips

  // `preview` defaults to cleared on every navigation, so a demo-panel
  // preview can't leak into a real call/outcome/decision screen reached
  // afterwards — pass it explicitly in extra to start or keep one.
  const go = (screen, extra = {}) => setS((prev) => ({ ...prev, preview: null, ...extra, screen }))
  const fail = (e) => setS((prev) => ({ ...prev, error: e.message || String(e) }))

  const updateSaved = useCallback((change) => {
    setSaved((prev) => {
      const next = change(prev)
      save(next)
      return next
    })
  }, [])

  const refreshTrip = useCallback(async (id) => {
    const trip = await api.getTrip(id)
    setTrips((prev) => ({ ...prev, [id]: trip }))
    return trip
  }, [])

  // ---- loading and live updates -------------------------------------------

  const tripIds = Object.keys(trips)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Sync the profile, then the calendar (the backend keeps the entries
        // that need a ride) and everything else Leeway knows.
        await api.putRider(riderId, riderProfile(callPhone))
        if (!cancelled) setSyncedRider(riderId)
        const [checked, list, thread] = await Promise.all([
          api.syncCalendar(riderId, calendarEntries(callPhone)),
          api.riderTrips(riderId),
          api.riderMessages(riderId),
        ])
        const evs = await Promise.all(list.map((t) => api.events(t.id)))
        if (cancelled) return
        const appts = checked.calendar.map(appointmentOf)
        setAppointments(appts)
        setSkipped(checked.skipped)
        setEvents(Object.fromEntries(list.map((t, i) => [t.id, evs[i]])))
        setMessages({ [riderId]: thread })
        setTrips(Object.fromEntries(list.map((t) => [t.id, t])))
        // Pick up where the rider left off: plans still waiting to be booked first.
        const waiting = list.filter((t) => WAITING.includes(t.status)).map((t) => t.id)
        if (waiting.length) {
          go('recommend', { queue: waiting, qi: 0 })
        } else if (list.length === 0 && appts.length) {
          // A brand new rider: book the first appointment automatically, so
          // Chat as home opens already showing it instead of the bare
          // "nothing booked yet" state — stays on the loading screen meanwhile.
          await autoBookFirst(appts[0])
          if (!cancelled) go('chatHome')
        } else {
          go('chatHome')
        }
      } catch (e) {
        if (!cancelled) fail(e)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderId]) // later changes arrive through the streams below

  // A new number to call: save the profile and calendar again; it applies to
  // rides planned from now on.
  const syncedPhone = useRef(callPhone)
  useEffect(() => {
    if (syncedRider !== riderId || syncedPhone.current === callPhone) return
    syncedPhone.current = callPhone
    Promise.all([
      api.putRider(riderId, riderProfile(callPhone)),
      api.syncCalendar(riderId, calendarEntries(callPhone)).then((checked) => {
        setAppointments(checked.calendar.map(appointmentOf))
        setSkipped(checked.skipped)
      }),
    ]).catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPhone, syncedRider, riderId])

  // What a new activity event means for the screen the rider is on.
  const onTripEvent = useCallback(
    (tripId, ev) => {
      setEvents((prev) => {
        const list = prev[tripId] || []
        return list.some((e) => e.id === ev.id) ? prev : { ...prev, [tripId]: [...list, ev] }
      })
      const before = tripsRef.current[tripId]
      refreshTrip(tripId).catch(() => {})

      setS((prev) => {
        const planning = prev.screen === 'recommend' || prev.screen === 'working'
        if (ev.kind === 'call_started' && ev.data.call_kind === 'late_notice' && !planning) {
          return { ...prev, screen: 'call', callTripId: tripId }
        }
        if (ev.kind === 'call_ended' && ev.data.call_kind === 'late_notice' && prev.callTripId === tripId) {
          const held = ev.data.result?.appointment_held
          if (held === false) {
            return { ...prev, screen: 'decision', decision: { tripId, choice: 'offer' } }
          }
          return {
            ...prev,
            screen: 'outcome',
            showTranscript: false,
            outcome: { tripId, kind: held ? 'held' : 'unclear' },
          }
        }
        if (ev.kind === 'appointment_moved' && !planning) {
          return {
            ...prev,
            screen: 'outcome',
            showTranscript: false,
            outcome: { tripId, kind: 'moved', was: before?.arrive_by },
          }
        }
        return prev
      })
    },
    [refreshTrip],
  )

  const onMessage = useCallback((msg) => {
    setMessages((prev) => {
      const list = prev[msg.thread_id] || []
      return list.some((m) => m.id === msg.id) ? prev : { ...prev, [msg.thread_id]: [...list, msg] }
    })
  }, [])

  // Trips appear here when the app creates them, or when Leeway schedules one in chat.
  const onTrip = useCallback((trip) => {
    setTrips((prev) => (prev[trip.id] ? prev : { ...prev, [trip.id]: trip }))
    setEvents((prev) => (prev[trip.id] ? prev : { ...prev, [trip.id]: [] }))
  }, [])

  // Only once the rider exists: EventSource gives up for good on a 404.
  useEffect(
    () => (syncedRider === riderId ? streamRider(riderId, { onMessage, onTrip }) : undefined),
    [syncedRider, riderId, onMessage, onTrip],
  )

  const streamKey = tripIds.join(',')
  useEffect(() => {
    const closers = tripIds.map((id) => streamTrip(id, { onEvent: (ev) => onTripEvent(id, ev) }))
    return () => closers.forEach((close) => close())
  }, [streamKey, onTripEvent]) // streamKey stands in for tripIds

  // A clock for the call timer.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  // Previous on-time odds, per trip, so the live-trip screen can show
  // "Up from 74%" / "Down from 88%" against the backend's real outlook.
  const prevOddsRef = useRef({})
  useEffect(() => {
    if (current?.status === 'riding' && current.outlook) {
      prevOddsRef.current[current.id] = current.outlook.p_on_time
    }
  })

  // ---- actions --------------------------------------------------------------

  async function createTrips(appointments) {
    const created = await Promise.all(
      appointments.map((a) =>
        api.createTrip({
          rider: { name: RIDER.name },
          appointment: { name: a.location.name, phone: a.location.phone },
          title: a.title,
          rider_id: riderId,
          calendar_event_id: a.id,
          origin: RIDER.home,
          dest: a.location.address,
          arrive_by: toLocalISO(a.start),
          certainty: 0.9,
          permissions: { may_call_appointment: !!a.location.phone, share_rider_name: true, max_calls: 3 },
        }),
      ),
    )
    created.forEach(onTrip)
    return created.map((t) => t.id)
  }

  // Plans and books one appointment silently in the background — no
  // "Here's what I'd book" or "Calling East Bay Paratransit" in between,
  // since the rider never asked for this one; it's just how the app opens.
  // Quietly gives up on any error, leaving the rider on the empty chatHome.
  async function autoBookFirst(appointment) {
    try {
      const [tripId] = await createTrips([appointment])
      let trip = await refreshTrip(tripId)
      for (let i = 0; i < 40 && trip.status === 'planning'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        trip = await refreshTrip(tripId)
      }
      if (trip.status !== 'planned' || !trip.plan) return
      await requestPickupWindow(() => {})
      await api.book(tripId, trip.plan.recommended.pickup_time)
      const confirmation = await confirmBooking()
      updateSaved((prev) => ({ ...prev, confirmations: { ...prev.confirmations, [tripId]: confirmation } }))
      await refreshTrip(tripId)
    } catch {
      // Not fatal — the rider just sees nothing booked yet.
    }
  }

  async function arrange(appointments) {
    try {
      setS((prev) => ({ ...prev, error: '' }))
      const ids = await createTrips(appointments)
      // Stay on "discover" (the button shows it's working) until the first
      // recommendation is actually ready, then jump straight to it — no
      // half-loaded "Here's what I'd book" in between.
      setS((prev) => ({ ...prev, pending: { queue: ids, qi: 0 } }))
    } catch (e) {
      fail(e)
    }
  }

  // Once a pending recommendation's trip leaves "planning", move to it.
  useEffect(() => {
    if (!s.pending) return
    const t = trips[s.pending.queue[s.pending.qi]]
    if (t && t.status !== 'planning') {
      const { queue, qi } = s.pending
      go('recommend', { queue, qi, pending: null, booking: null })
    }
  }, [trips, s.pending])

  // If the rider backs out of "working" before the call finishes, the
  // booking shouldn't still go through behind their back.
  const bookingAbortedRef = useRef(new Set())
  useEffect(() => {
    if (s.screen === 'working' || !s.booking || s.booking.step >= 3) return
    bookingAbortedRef.current.add(s.booking.tripId)
  }, [s.screen, s.booking])

  async function startBooking(trip) {
    bookingAbortedRef.current.delete(trip.id)
    go('working', { booking: { tripId: trip.id, step: 0 }, showTranscript: false })
    const step = (n, extra = {}) =>
      setS((prev) => ({ ...prev, booking: { ...prev.booking, step: n, ...extra } }))
    try {
      await requestPickupWindow(step)
      const confirmation = await confirmBooking()
      // The actual commit to EBP — skip it if the rider already left.
      if (bookingAbortedRef.current.has(trip.id)) return
      await api.book(trip.id, trip.plan.recommended.pickup_time)
      updateSaved((prev) => ({ ...prev, confirmations: { ...prev.confirmations, [trip.id]: confirmation } }))
      await refreshTrip(trip.id)
      step(3, { confirmation })
    } catch (e) {
      step(0, { error: e.message })
    }
  }

  async function send(text) {
    if (!text.trim() || s.sending) return
    setS((prev) => ({ ...prev, draft: '', sending: true }))
    try {
      const msgs = await api.sendRiderMessage(riderId, text)
      msgs.forEach(onMessage)
    } catch (e) {
      fail(e)
    } finally {
      setS((prev) => ({ ...prev, sending: false }))
    }
  }

  // ---- talking to Leeway: hold the mic, speak, let go -----------------------

  const setVoice = (voice) => setS((prev) => ({ ...prev, voice }))

  async function holdStart() {
    const v = voiceRef.current
    v.stopAudio?.()
    if (v.stop || v.starting || s.voice === 'thinking') return
    v.starting = true
    v.released = false
    try {
      const stop = await startRecording()
      v.starting = false
      // Let go while the microphone was starting (or its permission prompt
      // was up): drop the recording rather than listen with nobody holding.
      if (v.released) {
        await stop()
        return setVoice('idle')
      }
      v.stop = stop
      setVoice('listening')
    } catch (e) {
      v.starting = false
      v.stop = null
      fail(new Error(`I can't use the microphone: ${e.message}`))
    }
  }

  async function holdEnd() {
    if (voiceRef.current.starting) {
      voiceRef.current.released = true
      return
    }
    const stop = voiceRef.current.stop
    if (!stop) return
    voiceRef.current.stop = null
    const { blob, seconds } = await stop()
    if (seconds < 0.4) return setVoice('idle') // a tap, not speech
    openChat()
    setS((prev) => ({ ...prev, voice: 'thinking', sending: true }))
    try {
      const turn = await api.sendVoice(riderId, blob)
      turn.messages.forEach(onMessage)
      const answer = turn.messages.findLast((m) => m.sender === 'agent')
      if (!turn.transcript || !answer) {
        if (!turn.transcript) fail(new Error('I didn’t catch that. Hold the mic and try again.'))
        return setS((prev) => ({ ...prev, voice: 'idle', sending: false }))
      }
      setS((prev) => ({ ...prev, voice: 'speaking', sending: false }))
      const audio = await api.speech(answer.text)
      voiceRef.current.stopAudio = playAudio(audio, () => {
        voiceRef.current.stopAudio = null
        setVoice('idle')
      })
    } catch (e) {
      fail(e)
      setS((prev) => ({ ...prev, voice: 'idle', sending: false }))
    }
  }

  // ---- derived state --------------------------------------------------------

  const linked = Object.values(trips)
  const byTime = (a, b) => new Date(a.arrive_by) - new Date(b.arrive_by)
  const booked = linked.filter((t) => ACTIVE.includes(t.status)).sort(byTime)
  const waiting = linked.filter((t) => WAITING.includes(t.status)).sort(byTime)
  const unplanned = calendar.filter(
    (a) => a.start > Date.now() && !linked.some((t) => t.calendar_event_id === a.id),
  )
  const current = booked[0] || linked.filter((t) => t.status !== 'completed').sort(byTime)[0]
  const tripEvents = (t) => (t ? events[t.id] || [] : [])

  const pickupWindow = (t) => {
    const start = t.booked_pickup || t.plan?.recommended.pickup_time
    return start ? { start, end: addMinutes(start, WINDOW_MINUTES) } : null
  }
  const windowText = (w) => `${clock(w.start)} – ${clock(w.end)}`
  const odds = (t) => t.outlook?.p_on_time ?? t.plan?.recommended.p_on_time

  // ---- discover ------------------------------------------------------------

  const selectedApps = unplanned.filter((a) => s.sel[a.id] ?? true)
  const discover = {
    items: unplanned.map((a) => ({
      key: a.id,
      title: a.title,
      when: `${shortDate(a.start)} · ${clock(a.start)}`,
      location: a.location.name,
      selected: s.sel[a.id] ?? true,
      onToggle: () =>
        setS((prev) => ({ ...prev, sel: { ...prev.sel, [a.id]: !(prev.sel[a.id] ?? true) } })),
    })),
    skipped,
    arrangeLabel: s.pending
      ? 'Arranging…'
      : selectedApps.length
        ? `Arrange rides (${selectedApps.length})`
        : 'Select an appointment',
    arrangeDisabled: !!s.pending || selectedApps.length === 0,
    onArrange: () => selectedApps.length && arrange(selectedApps),
    onNotNow: () => go('chatHome'),
  }

  // ---- which home screen ------------------------------------------------------

  let homeScreen = 'home'
  if (!booked.length) homeScreen = waiting.length ? 'recommend' : unplanned.length ? 'discover' : 'empty'
  else if (booked.length > 1 && !isToday(booked[0].arrive_by) && booked[0].status !== 'riding') homeScreen = 'everyday'
  // A demo-panel preview of the home screen wants "home" itself, regardless
  // of what the rider's real trips would otherwise show here.
  const previewingHome = s.preview === 'homeToday' || s.preview === 'homeFuture'
  const viewScreen = s.screen === 'home' ? (previewingHome ? 'home' : homeScreen) : s.screen

  // ---- recommend (and planning, which shows as "working") ------------------

  // From home, a plan that's waiting to be booked: show the next one.
  const fromQueue = s.screen === 'recommend' && s.queue.length > 0
  const queue = fromQueue ? s.queue : waiting.map((t) => t.id)
  const qi = fromQueue ? s.qi : 0
  const recTrip = trips[queue[qi]]
  let recommend = null
  let planning = null
  if (viewScreen === 'recommend' && s.preview === 'recommend') {
    recommend = {
      ready: true,
      stepLabel: 'APPOINTMENT',
      headlineGray: 'For neurology on Tue, Nov 3 at 10:30 AM, this gives you the best chance of arriving on time.',
      locationName: 'Kaiser Oakland',
      locationAddress: '3600 Broadway, Oakland',
      windowValue: '9:15 AM – 9:45 AM',
      dayLine: 'Tuesday. Be ready at 9:15 AM.',
      oddsLabel: 'Chance of arriving by 10:30 AM',
      oddsValue: '86%',
      oddsColor: oddsColor(0.86),
      explanation: 'Weekday morning rides from your area to Kaiser took 35 to 60 minutes over the last 3 months.',
      onConfirm: () => go('working', { preview: 'working' }),
      onNotNow: () => go('chatHome', { preview: null }),
    }
  } else if (viewScreen === 'recommend' && recTrip) {
    if (recTrip.status === 'planned' && recTrip.plan) {
      const w = pickupWindow(recTrip)
      const arrive = clock(recTrip.arrive_by)
      recommend = {
        ready: true,
        stepLabel: queue.length > 1 ? `APPOINTMENT ${qi + 1} OF ${queue.length}` : 'APPOINTMENT',
        headlineGray: `For ${titleOf(recTrip).toLowerCase()} on ${shortDate(recTrip.arrive_by).replace(',', '')} at ${arrive}, this gives you the best chance of arriving on time.`,
        locationName: recTrip.appointment.name,
        locationAddress: recTrip.dest,
        windowValue: windowText(w),
        dayLine: `${isToday(w.start) ? 'Today' : weekday(w.start)}. Be ready at ${clock(w.start)}.`,
        oddsLabel: `Chance of arriving by ${arrive}`,
        oddsValue: percent(recTrip.plan.recommended.p_on_time),
        oddsColor: oddsColor(recTrip.plan.recommended.p_on_time),
        explanation: recTrip.plan.explanation,
        onConfirm: () => {
          if (!fromQueue) go('recommend', { queue, qi })
          startBooking(recTrip)
        },
        onNotNow: () => go('chatHome'),
      }
    } else {
      const ev = tripEvents(recTrip)
      const callStarted = lastOf(ev, 'call_started', 'policy_inquiry')
      const callEnded = lastOf(ev, 'call_ended', 'policy_inquiry')
      const failed = recTrip.status === 'failed'
      const policy = recTrip.policy
      const appt = recTrip.appointment.name
      const tasks = []
      if (callStarted) {
        tasks.push(
          pendingTask(
            `Calling ${appt} about arriving late`,
            !!callEnded,
            policy ? `${firstWord(appt)} holds your slot for ${policy.grace_minutes} min` : 'No clear answer, so I’ll plan without extra time',
            true,
          ),
        )
      }
      tasks.push(
        pendingTask('Finding your pickup time', false, '', !callStarted || !!callEnded),
      )
      planning = failed
        ? {
            headlineLead: 'I couldn’t plan this ride.',
            headlineGray: 'Something went wrong on my side. You can try again.',
            tasks: [],
            done: true,
            nextLabel: 'Try again',
            onNext: () => api.replan(recTrip.id).then(() => refreshTrip(recTrip.id)).catch(fail),
          }
        : {
            headlineLead: 'Working out your ride.',
            headlineGray: callStarted
              ? `I’m asking ${appt} how late you can arrive, then I’ll pick your pickup time.`
              : 'I’m checking how long rides like this take.',
            tasks,
            done: false,
          }
      // The rider lands on "Recommended booking" straight from "Arrange
      // rides" — no separate loading screen — so this screen shows the same
      // wait as a pending headline instead of a distinct step.
      recommend = {
        ready: false,
        failed,
        headlineGray: planning.headlineGray,
        onRetry: planning.onNext,
        onNotNow: () => go('chatHome'),
      }
    }
  }

  // ---- working: booking with EBP --------------------------------------------

  let working = planning
  if (s.screen === 'working' && s.preview === 'working') {
    working = {
      headlineLead: 'Booked for Tuesday.',
      headlineGray: 'EBP confirmed your pickup window. Be ready at 9:15 AM.',
      tasks: [
        { label: 'Connected to EBP reservations', state: 'done' },
        { label: 'Pickup window 9:15 AM – 9:45 AM accepted', state: 'done' },
        { label: 'Confirmation #48213', state: 'done' },
      ],
      done: true,
      transcript: [
        { who: 'LEEWAY', t: 'Hi, I’m calling to book a paratransit ride for Denise Carter to Kaiser Oakland.' },
        { who: 'EBP', t: 'One moment, let me check availability.' },
        { who: 'LEEWAY', t: 'Could I request a pickup window of 9:15 AM – 9:45 AM?' },
        { who: 'EBP', t: 'That works for us.' },
        { who: 'EBP', t: 'Confirmed. Your confirmation number is #48213.' },
      ],
      showTranscript: s.showTranscript,
      onToggleTranscript: () => setS((prev) => ({ ...prev, showTranscript: !prev.showTranscript })),
      nextLabel: 'Done',
      nextDisabled: false,
      onNext: () => go('chatHome'),
    }
  } else if (s.screen === 'working' && s.booking) {
    const t = trips[s.booking.tripId]
    const w = t && pickupWindow(t)
    const step = s.booking.step
    const done = step >= 3
    const more = s.qi + 1 < s.queue.length && s.queue[s.qi] === s.booking.tripId
    const nextTrip = more ? trips[s.queue[s.qi + 1]] : null
    // EBP only takes bookings by phone (see mocks/paratransit.js) — a sample
    // transcript of that mock call, built up to how far the call has gotten.
    const appt = t?.appointment.name || 'the clinic'
    const transcript = []
    if (step >= 1) {
      transcript.push({ who: 'LEEWAY', t: `Hi, I’m calling to book a paratransit ride for Denise Carter to ${appt}.` })
      transcript.push({ who: 'EBP', t: 'One moment, let me check availability.' })
    }
    if (w && step >= 2) {
      transcript.push({ who: 'LEEWAY', t: `Could I request a pickup window of ${windowText(w)}?` })
      transcript.push({ who: 'EBP', t: 'That works for us.' })
    }
    if (done) {
      transcript.push({ who: 'EBP', t: `Confirmed. Your confirmation number is ${s.booking.confirmation}.` })
    }
    working = s.booking.error
      ? {
          headlineLead: 'That didn’t go through.',
          headlineGray: s.booking.error,
          tasks: [],
          done: true,
          nextLabel: 'Back',
          onNext: () => go('recommend'),
        }
      : {
          headlineLead: done ? `Booked for ${isToday(w.start) ? 'today' : weekday(w.start)}.` : 'Calling East Bay Paratransit.',
          headlineGray: done
            ? `EBP confirmed your pickup window. Be ready at ${clock(w.start)}.`
            : 'Nothing is booked until they confirm. You can leave the app.',
          tasks: [
            pendingTask('Calling reservations', step >= 1, 'Connected to EBP reservations', true),
            pendingTask(`Requesting ${windowText(w)}`, step >= 2, `Pickup window ${windowText(w)} accepted`, step >= 1),
            pendingTask('Waiting for confirmation', done, `Confirmation ${s.booking.confirmation}`, step >= 2),
          ],
          done,
          transcript,
          showTranscript: s.showTranscript,
          onToggleTranscript: () => setS((prev) => ({ ...prev, showTranscript: !prev.showTranscript })),
          nextLabel: s.pending ? 'Finding your next ride…' : nextTrip ? `Next: ${titleOf(nextTrip)}` : 'Done',
          nextDisabled: !!s.pending,
          // Stay on this screen (booking stays set so it keeps rendering)
          // until the next trip is actually planned — the pending-watcher
          // effect above does the actual screen change once it's ready.
          onNext: () =>
            nextTrip
              ? setS((prev) => ({ ...prev, pending: { queue: s.queue, qi: s.qi + 1 } }))
              : go('chatHome', { booking: null }),
        }
  }

  // ---- home -----------------------------------------------------------------

  const lastTripDone = linked.filter((t) => t.status === 'completed').sort(byTime).at(-1)

  let home = null
  if (s.screen === 'home' && (s.preview === 'homeToday' || s.preview === 'homeFuture')) {
    const today = s.preview === 'homeToday'
    home = {
      today,
      headlineLead: today ? 'Be ready downstairs at 9:15 AM.' : 'You’re set for Tuesday.',
      headlineGray: today
        ? 'Your ride to neurology picks you up between 9:15 AM and 9:45 AM.'
        : 'Be ready downstairs at 9:15 AM. EBP confirmed your pickup window.',
      oddsEyebrow: 'Chance of arriving by 10:30 AM',
      oddsValue: '86%',
      oddsColor: oddsColor(0.86),
      pickupWindow: '9:15 AM – 9:45 AM',
      locationName: 'Kaiser Oakland',
      locationAddress: '3600 Broadway, Oakland',
      monitorText: today
        ? 'I’m watching this trip. If it starts to look late, I’ll call Kaiser for you.'
        : 'I’ll watch the trip on Tuesday.',
    }
  } else if (current && pickupWindow(current)) {
    const w = pickupWindow(current)
    const riding = current.status === 'riding'
    const today = isToday(current.arrive_by)
    const appt = current.appointment.name
    home = {
      today,
      headlineLead: riding
        ? 'You’re on your way.'
        : today
          ? `Be ready downstairs at ${clock(w.start)}.`
          : `You’re set for ${weekday(current.arrive_by)}.`,
      headlineGray: riding
        ? `I’m watching the trip. If it starts to look late, I’ll call ${firstWord(appt)} for you.`
        : today
          ? `Your ride to ${titleOf(current).toLowerCase()} picks you up between ${clock(w.start)} and ${clock(w.end)}.`
          : `Be ready downstairs at ${clock(w.start)}. EBP confirmed your pickup window.`,
      oddsEyebrow: `Chance of arriving by ${clock(current.arrive_by)}`,
      oddsValue: odds(current) != null ? percent(odds(current)) : '–',
      oddsColor: oddsColor(odds(current)),
      pickupWindow: windowText(w),
      locationName: appt,
      locationAddress: current.dest,
      monitorText: riding || today
        ? `I’m watching this trip. If it starts to look late, I’ll call ${firstWord(appt)} for you.`
        : `I’ll watch the trip on ${weekday(current.arrive_by)}.`,
    }
  }

  // ---- live trip (screen 8, shown once the van has picked the rider up) -----
  // The backend has no GPS feed (see Trip in core/schemas.py — just
  // timestamps), so `progress`/the map position are a sample path (see
  // lib/liveRoute.js), same as the design prototype's own demo position.
  // Odds, the reason and the timing are the real backend outlook.

  let ride = null
  if (s.screen === 'ride' && s.preview === 'ride') {
    ride = {
      headlineLead: 'You’re on your way.',
      headlineGray: 'Picked up at 9:22 AM. I’m watching this trip and will update your chance of arriving on time.',
      mapLabel: 'Map of your ride to Kaiser Oakland',
      progress: 0.4,
      heavyTraffic: false,
      label: 'Chance of arriving by 10:30 AM',
      big: '86%',
      color: oddsColor(0.86),
      delta: 'Up from 74%',
      reason: 'Traffic around you is light.',
      rowLabel: 'Distance to Kaiser Oakland',
      rowValue: `${milesBetween(routeAt(0.4), DESTINATION).toFixed(1)} mi`,
    }
  } else if (current?.status === 'riding') {
    const pickedUpAt = current.live.picked_up_at ? new Date(current.live.picked_up_at).getTime() : null
    const expectedArrival = current.outlook?.expected_arrival
      ? new Date(current.outlook.expected_arrival).getTime()
      : null
    const progress =
      pickedUpAt && expectedArrival && expectedArrival > pickedUpAt
        ? Math.max(0, Math.min(1, (now - pickedUpAt) / (expectedArrival - pickedUpAt)))
        : 0
    const pOnTime = current.outlook?.p_on_time
    const minutesLate = current.outlook?.minutes_late ?? 0
    const prevOdds = prevOddsRef.current[current.id]
    const delta =
      prevOdds == null || pOnTime == null || prevOdds === pOnTime
        ? 'Live'
        : pOnTime > prevOdds
          ? `Up from ${percent(prevOdds)}`
          : `Down from ${percent(prevOdds)}`
    const appt = current.appointment.name
    const riderPos = routeAt(progress)
    ride = {
      headlineLead: 'You’re on your way.',
      headlineGray: current.live.picked_up_at
        ? `Picked up at ${clock(current.live.picked_up_at)}. I’m watching this trip and will update your chance of arriving on time.`
        : 'I’m watching this trip and will update your chance of arriving on time.',
      mapLabel: `Map of your ride to ${appt}`,
      progress,
      heavyTraffic: minutesLate >= 10,
      label: `Chance of arriving by ${clock(current.arrive_by)}`,
      big: pOnTime != null ? percent(pOnTime) : '–',
      color: oddsColor(pOnTime),
      delta,
      reason:
        minutesLate > 0
          ? `Running about ${minutesLate} minute${minutesLate === 1 ? '' : 's'} behind right now.`
          : 'On track to arrive on time.',
      rowLabel: `Distance to ${appt}`,
      rowValue: `${milesBetween(riderPos, DESTINATION).toFixed(1)} mi`,
    }
  }

  // Calendar appointments in the next week that aren't booked (or riding) yet
  // — distinct from "Also booked", which is other trips already confirmed.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const inNextWeek = calendar.filter((a) => {
    if (a.start <= Date.now() || a.start > Date.now() + WEEK_MS) return false
    const trip = linked.find((t) => t.calendar_event_id === a.id)
    return !trip || !ACTIVE.includes(trip.status)
  })

  const everyday =
    s.screen === 'everyday' && s.preview === 'everyday'
      ? {
          next: {
            title: 'Neurology',
            day: 'Tuesday',
            location: 'Kaiser Oakland',
            date: 'TUE, NOV 3',
            oddsValue: '86%',
            oddsColor: oddsColor(0.86),
            arriveByTime: '10:30 AM',
            pickupWindow: '9:15 AM – 9:45 AM',
          },
          alsoBooked: [
            { title: 'Physical Therapy', date: 'Thu, Nov 5 · 2:00 PM', oddsText: '82%', oddsColor: oddsColor(0.82) },
            { title: 'Dentist', date: 'Mon, Nov 16 · 11:00 AM', oddsText: '88%', oddsColor: oddsColor(0.88) },
          ],
          upcoming: [{ key: 'preview-eye', title: 'Eye exam', date: 'Wed, Nov 18 · 1:00 PM', onBook: () => {} }],
        }
      : booked.length || inNextWeek.length
        ? {
            next: booked.length
              ? {
                  title: titleOf(booked[0]),
                  day: weekday(booked[0].arrive_by),
                  location: booked[0].appointment.name,
                  date: shortDate(booked[0].arrive_by).toUpperCase(),
                  oddsValue: odds(booked[0]) != null ? percent(odds(booked[0])) : '–',
                  oddsColor: oddsColor(odds(booked[0])),
                  arriveByTime: clock(booked[0].arrive_by),
                  pickupWindow: windowText(pickupWindow(booked[0])),
                }
              : null,
            alsoBooked: booked.slice(1).map((t) => ({
              title: titleOf(t),
              date: `${shortDate(t.arrive_by)} · ${clock(t.arrive_by)}`,
              oddsText: odds(t) != null ? percent(odds(t)) : '–',
              oddsColor: oddsColor(odds(t)),
            })),
            upcoming: inNextWeek.map((a) => {
              const trip = linked.find((t) => t.calendar_event_id === a.id)
              return {
                key: a.id,
                title: a.title,
                date: `${shortDate(a.start)} · ${clock(a.start)}`,
                onBook: trip
                  ? () => go('recommend', { queue: [trip.id], qi: 0 })
                  : () => arrange([a]),
              }
            }),
          }
        : null

  const empty =
    s.screen === 'empty' && s.preview === 'empty'
      ? {
          lastTrip: { title: 'Physical Therapy', date: 'Thu, Nov 5', arrivedText: '1:41 PM, on time' },
          onRestart: () => go('discover', { preview: null }),
        }
      : {
          lastTrip: lastTripDone && {
            title: titleOf(lastTripDone),
            date: shortDate(lastTripDone.arrive_by),
            arrivedText: lastTripDone.live.arrived_at
              ? `${clock(lastTripDone.live.arrived_at)}, ${new Date(lastTripDone.live.arrived_at) <= new Date(lastTripDone.arrive_by) ? 'on time' : 'late'}`
              : 'Done',
          },
          onRestart: () => go('discover'),
        }

  // ---- call -----------------------------------------------------------------

  const callTrip = trips[s.callTripId]
  let call = null
  if (s.screen === 'call' && s.preview === 'call') {
    call = {
      headlineLead: 'You may be 15 minutes late.',
      headlineGray: 'I’m calling Kaiser Oakland to ask if they can still see you.',
      statusLabel: 'On a call',
      callTime: '0:20',
      lines: [
        {
          who: 'FRONT DESK',
          t: 'Let me check with Dr. Patel’s team …',
          tone: 'secondary',
        },
        { who: 'FRONT DESK', t: 'She can come at 11:00 AM. Same doctor.', tone: 'secondary' },
      ],
      waitingFor: 'Waiting for: whether Dr. Patel can see you after 10:45 AM.',
    }
  } else if (s.screen === 'call' && callTrip) {
    const ev = tripEvents(callTrip)
    const started = lastOf(ev, 'call_started', 'late_notice')
    const since = started ? ev.slice(ev.indexOf(started)) : []
    const ended = since.find((e) => e.kind === 'call_ended')
    const lines = ended
      ? ended.data.transcript || []
      : since.filter((e) => e.kind === 'call_progress').flatMap((e) => e.data.lines)
    const seconds = started ? Math.max(0, Math.floor(((ended ? new Date(ended.at) : now) - new Date(started.at)) / 1000)) : 0
    const late = callTrip.outlook?.minutes_late
    call = {
      headlineLead: late ? `You may be ${late} minutes late.` : 'Your ride may be late.',
      headlineGray: `I’m calling ${callTrip.appointment.name} to ask if they can still see you.`,
      statusLabel: ended ? 'Call ended' : 'On a call',
      callTime: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
      lines: lines.slice(-2).map((l) => ({
        who: l.role === 'agent' ? 'LEEWAY' : 'FRONT DESK',
        t: l.text,
        tone: l.role === 'agent' ? 'accent' : 'secondary',
      })),
      waitingFor: ended
        ? 'Call finished. Updating your plan.'
        : lines.length
          ? 'Waiting for: whether they can still see you.'
          : 'Waiting for: the front desk to pick up.',
    }
  }

  // ---- outcome ---------------------------------------------------------------

  const outTrip = s.outcome && trips[s.outcome.tripId]
  let outcome = null
  if (s.screen === 'outcome' && s.preview === 'outcome') {
    outcome = {
      pill: 'Rescheduled',
      headlineLead: 'Kaiser moved you to 11:00 AM.',
      headlineGray: 'Same doctor. Keep waiting downstairs; your ride is still coming.',
      was: '10:30 AM',
      now: '11:00 AM',
      detail: 'Neurology with Dr. Patel. Confirmed by the front desk at 9:24 AM.',
      oddsLabel: 'Chance of arriving by 11:00 AM',
      oddsValue: '91%',
      oddsColor: oddsColor(0.91),
      showLocation: true,
      locationName: 'Kaiser Oakland',
      locationAddress: '3600 Broadway, Oakland',
      transcript: [
        {
          who: 'LEEWAY',
          t: 'Hi, I’m calling for Denise Carter. She has a 10:30 AM appointment with Dr. Patel, and her paratransit ride is running about 15 minutes late.',
        },
        { who: 'FRONT DESK', t: 'Let me check with Dr. Patel’s team …' },
        { who: 'FRONT DESK', t: 'She can come at 11:00 AM. Same doctor.' },
        { who: 'LEEWAY', t: 'Great, please move her to 11:00 AM. Thank you.' },
      ],
      showTranscript: false,
      onToggleTranscript: () => setS((prev) => ({ ...prev, showTranscript: !prev.showTranscript })),
      firstLabel: 'Back to my ride',
      onFirst: () => go('home', { preview: null }),
    }
  } else if (s.screen === 'outcome' && outTrip) {
    const ev = tripEvents(outTrip)
    const lastCall = lastOf(ev, 'call_ended')
    const result = lastCall?.data.result || {}
    const appt = outTrip.appointment.name
    const notes = result.notes || result.response || ''
    const base = {
      transcript: (lastCall?.data.transcript || []).map((l) => ({
        who: l.role === 'agent' ? 'LEEWAY' : 'FRONT DESK',
        t: l.text,
      })),
      showTranscript: s.showTranscript,
      onToggleTranscript: () => setS((prev) => ({ ...prev, showTranscript: !prev.showTranscript })),
      oddsLabel: `Chance of arriving by ${clock(outTrip.arrive_by)}`,
      oddsValue: odds(outTrip) != null ? percent(odds(outTrip)) : '–',
      oddsColor: oddsColor(odds(outTrip)),
      showLocation: true,
      locationName: appt,
      locationAddress: outTrip.dest,
      firstLabel: 'Back to my ride',
      onFirst: () => go('home'),
    }
    if (s.outcome.kind === 'moved') {
      outcome = {
        ...base,
        pill: 'Rescheduled',
        headlineLead: `${firstWord(appt)} moved you to ${clock(outTrip.arrive_by)}.`,
        headlineGray: outTrip.status === 'riding'
          ? 'Same place. Keep going; your ride is still on its way.'
          : 'Your old pickup was for the old time, so I’m planning a new one.',
        was: s.outcome.was ? clock(s.outcome.was) : '',
        now: clock(outTrip.arrive_by),
        detail: notes || `Confirmed by ${appt}.`,
      }
    } else if (s.outcome.kind === 'held') {
      outcome = {
        ...base,
        pill: 'Still on',
        headlineLead: `${firstWord(appt)} can still see you.`,
        headlineGray: 'Keep going; your ride is still on its way.',
        was: '',
        now: clock(outTrip.arrive_by),
        detail: notes || `Confirmed by ${appt}.`,
      }
    } else {
      outcome = {
        ...base,
        pill: 'Call ended',
        headlineLead: `I couldn’t confirm with ${firstWord(appt)}.`,
        headlineGray: 'I let them know you’re running late. Ask me if you want me to try again.',
        was: '',
        now: clock(outTrip.arrive_by),
        detail: notes || 'Nobody confirmed whether they can still see you.',
      }
    }
  }

  // ---- decision ----------------------------------------------------------------

  const decTrip = trips[s.decision.tripId]
  let decision = null
  if (s.screen === 'decision' && s.preview === 'decision') {
    const previewOptions = [
      {
        key: 'offer',
        title: 'Move to Thursday, 9:00 AM',
        tag: 'Recommended',
        sub: 'I’ll cancel today’s ride so it isn’t a no-show, then plan Thursday’s ride with you.',
        label: 'Confirm',
      },
      {
        key: 'keep',
        title: 'Keep today’s ride',
        tag: '',
        sub: 'The front desk says you may need to rebook when you arrive.',
        label: 'Keep today’s ride',
      },
      {
        key: 'talk',
        title: 'Talk it through with me',
        tag: '',
        sub: 'Ask about other times or anything else first.',
        label: 'Open chat',
      },
    ]
    const chosen = previewOptions.find((o) => o.key === s.decision.choice) || previewOptions[0]
    decision = {
      headlineLead: 'Kaiser can’t see you late today.',
      headlineGray: 'Dr. Patel’s next opening is Thursday at 9:00 AM. Here’s what I’d do.',
      options: previewOptions.map((o) => ({
        ...o,
        selected: o.key === chosen.key,
        onSelect: () => setS((prev) => ({ ...prev, decision: { ...prev.decision, choice: o.key } })),
      })),
      approveLabel: chosen.label,
      onApprove: () => go('home', { preview: null }),
    }
  } else if (s.screen === 'decision' && decTrip) {
    const lastCall = lastOf(tripEvents(decTrip), 'call_ended', 'late_notice')
    const notes = lastCall?.data.result?.notes || ''
    const appt = decTrip.appointment.name
    const options = [
      {
        key: 'offer',
        title: 'Take the time they offered',
        tag: 'Recommended',
        sub: 'I’ll call them back to confirm it, then update your trip.',
        label: 'Confirm',
        approve: () =>
          openChat(`Please tell ${appt} I’ll take the time they offered for my ${titleOf(decTrip).toLowerCase()} appointment.`),
      },
      {
        key: 'keep',
        title: 'Keep today’s ride',
        tag: '',
        sub: 'You can still go. They may ask you to rebook when you arrive.',
        label: 'Keep today’s ride',
        approve: () => go('home'),
      },
      {
        key: 'talk',
        title: 'Talk it through with me',
        tag: '',
        sub: 'Ask about other times or anything else first.',
        label: 'Open chat',
        approve: () => openChat(),
      },
    ]
    const chosen = options.find((o) => o.key === s.decision.choice) || options[0]
    decision = {
      headlineLead: `${firstWord(appt)} can’t see you late today.`,
      headlineGray: notes || 'Here’s what I’d do.',
      options: options.map((o) => ({
        ...o,
        selected: o.key === chosen.key,
        onSelect: () => setS((prev) => ({ ...prev, decision: { ...prev.decision, choice: o.key } })),
      })),
      approveLabel: chosen.label,
      onApprove: chosen.approve,
    }
  }

  // ---- chat --------------------------------------------------------------------

  function openChat(text) {
    setS((prev) => ({
      ...prev,
      screen: 'chat',
      back: prev.screen === 'chat' ? prev.back : prev.screen,
      draft: '',
    }))
    if (text) send(text)
  }

  const thread = messages[riderId] || []
  const chat = {
    isEmpty: !thread.length && !s.sending,
    messages: thread.map((m) => ({
      isMe: m.sender === 'rider',
      text: m.text,
      hasCard: false,
      hasActions: false,
      actions: [],
    })),
    typing: s.sending,
    suggestions: [
      'What’s coming up for me?',
      'I have a new appointment',
      'When should I be ready?',
    ].map((q) => ({ text: q, onClick: () => openChat(q) })),
    draft: s.draft,
    onDraftChange: (value) => setS((prev) => ({ ...prev, draft: value })),
    // Routes through openChat (not send directly) so sending from the
    // "chat as home" screen also switches to the thread screen.
    onSend: () => openChat(s.draft),
    onEnter: (e) => {
      if (e.key === 'Enter') openChat(s.draft)
    },
  }
  const closeChat = () => go(s.back === 'chat' ? 'home' : s.back || 'home')

  // ---- chat as home (screen 7c) ---------------------------------------------
  // An alternative home screen where the Ask Leeway bar is the main surface.
  // Widgets read the same trip state as the regular home/everyday screens.

  // The next 2 calendar appointments, whatever their booking state — not
  // just the unplanned ones, so "coming up" always reflects the calendar.
  // Whichever one is already shown in the "next ride" card isn't repeated here.
  const nextOnCalendar = calendar
    .filter((a) => a.start > Date.now() && a.id !== booked[0]?.calendar_event_id)
    .sort((a, b) => a.start - b.start)
    .slice(0, 2)

  const chatHome =
    s.screen === 'chatHome' && s.preview === 'chatHome'
      ? {
          nextRide: {
            dateCaps: 'TUE, NOV 3',
            window: '9:15 AM – 9:45 AM',
            title: 'Neurology, Kaiser Oakland',
            time: '10:30 AM',
            oddsValue: '86%',
            oddsColor: oddsColor(0.86),
            onClick: () => go('home', { preview: 'homeToday' }),
          },
          comingUp: {
            items: [
              {
                key: 'preview-pt',
                title: 'Physical Therapy',
                date: 'Thu, Nov 5 · 2:00 PM',
                status: null,
                actionLabel: 'Book ride',
                onAction: () => go('recommend', { preview: 'recommend' }),
              },
            ],
            onSeeAll: () => go('everyday', { preview: 'everyday' }),
          },
          suggestions: ['Can someone ride with me?', 'Cancel Tuesday’s ride'].map((q) => ({ text: q, onClick: () => {} })),
        }
      : {
          nextRide: booked.length
            ? {
                dateCaps: shortDate(booked[0].arrive_by).toUpperCase(),
                window: windowText(pickupWindow(booked[0])),
                title: `${titleOf(booked[0])}, ${booked[0].appointment.name}`,
                time: clock(booked[0].arrive_by),
                oddsValue: odds(booked[0]) != null ? percent(odds(booked[0])) : '–',
                oddsColor: oddsColor(odds(booked[0])),
                onClick: () => go('home'),
              }
            : null,
          comingUp: nextOnCalendar.length
            ? {
                items: nextOnCalendar.map((a) => {
                  const trip = linked.find((t) => t.calendar_event_id === a.id)
                  const date = `${shortDate(a.start)} · ${clock(a.start)}`
                  if (!trip) {
                    return { key: a.id, title: a.title, date, status: null, actionLabel: 'Book ride', onAction: () => arrange([a]) }
                  }
                  if (ACTIVE.includes(trip.status)) {
                    return { key: a.id, title: a.title, date, status: 'Booked', actionLabel: null, onAction: null }
                  }
                  return {
                    key: a.id,
                    title: a.title,
                    date,
                    status: null,
                    actionLabel: 'Book ride',
                    onAction: () => go('recommend', { queue: [trip.id], qi: 0 }),
                  }
                }),
                onSeeAll: () => go('everyday'),
              }
            : null,
          suggestions: [
            'Can someone ride with me?',
            booked.length ? `Cancel ${weekday(booked[0].arrive_by)}’s ride` : 'Cancel my next ride',
          ].map((q) => ({ text: q, onClick: () => openChat(q) })),
        }

  // ---- demo panel: live state and simulated ride updates -----------------------

  const restart = () => {
    voiceRef.current.stopAudio?.()
    updateSaved((prev) => ({ riderId: newRiderId(), confirmations: {}, callPhone: prev.callPhone }))
    setTrips({})
    setEvents({})
    setMessages({})
    // Back to 'loading' (INIT's default) — the load effect below picks the
    // new riderId up, books the first appointment, then lands on chatHome
    // already populated.
    setS(INIT)
  }
  // ---- which screen to show ----------------------------------------------------

  let screen = viewScreen
  // While planning, stay on "recommend" (it shows its own pending headline)
  // rather than detouring through a separate "working" screen — only a
  // trip that hasn't synced locally at all yet needs the loading screen.
  if (screen === 'recommend' && !recommend) screen = 'loading'
  if (screen === 'home' && !home) screen = 'loading'
  if (screen === 'everyday' && !everyday) screen = 'loading'
  if (screen === 'ride' && !ride) screen = 'loading'

  // ---- demo panel: jump to any screen, and simulate ride updates ---------------

  // Every screen the app has, with sample data so each opens on its own —
  // independent of the rider's real trips — for reviewing the whole app.
  // `active` highlights whichever one is currently on screen.
  const navStep = (n, label, active, onClick) => ({ n, label, active, onClick })
  // Only the screen the app actually opens on is a normal menu item. Every
  // other screen — older home variants, and the states a trip walks through
  // on its own (planning, on the way, at risk, chat) — still exists and still
  // works, but isn't something a rider (or a demo) should be jumping to
  // directly, so it's parked in the graveyard below instead of the menu.
  const groups = [
    {
      title: 'HOME',
      steps: [navStep('7c', 'Chat as home', screen === 'chatHome', () => go('chatHome', { preview: null }))],
    },
  ]
  const graveyard = [
    {
      title: 'HOME — OTHER VARIANTS',
      steps: [
        navStep('3b', 'Next ride detail — today', screen === 'home' && home?.today === true, () => go('home', { preview: 'homeToday' })),
        navStep('3', 'Next ride detail — future day', screen === 'home' && home?.today === false, () => go('home', { preview: 'homeFuture' })),
        navStep('3c', 'See all appointments', screen === 'everyday', () => go('everyday', { preview: 'everyday' })),
        navStep('3a', 'Home, nothing booked', screen === 'empty', () => go('empty', { preview: 'empty' })),
      ],
    },
    {
      title: 'PLANNING',
      steps: [
        navStep('1', 'Calendar discovery', screen === 'discover', () => go('discover', { preview: null })),
        navStep('2', 'Recommended booking', screen === 'recommend', () => go('recommend', { preview: 'recommend' })),
        navStep('2b', 'Leeway books with EBP', screen === 'working', () => go('working', { preview: 'working' })),
      ],
    },
    {
      title: 'ON THE WAY',
      steps: [navStep('8', 'Live trip', screen === 'ride', () => go('ride', { preview: 'ride' }))],
    },
    {
      title: 'RIDE AT RISK',
      steps: [
        navStep('4', 'Calling the clinic', screen === 'call', () => go('call', { preview: 'call' })),
        navStep('5', 'Rescheduled', screen === 'outcome', () => go('outcome', { preview: 'outcome' })),
      ],
    },
    {
      title: 'RIDER DECISION',
      steps: [navStep('6', 'Rider decision', screen === 'decision', () => go('decision', { preview: 'decision' }))],
    },
    {
      title: 'ASK LEEWAY',
      steps: [navStep('7', 'Ask Leeway', screen === 'chat', () => openChat())],
    },
  ]

  const simTrip = booked[0]
  const simulate = (label, run) => ({
    label,
    disabled: !simTrip,
    onClick: () => simTrip && run(simTrip).then(() => refreshTrip(simTrip.id)).catch(fail),
  })
  const demo = {
    apiBase: API_BASE,
    callsEnabled: !!callPhone,
    // Choosing the number to call: the server checks it (valid, not an agency
    // line, approved by PIN, not called too often) before any call is placed.
    calls: {
      phone: callPhone,
      async set(phone, pin) {
        let status = await api.checkCallNumber(phone)
        if (!status.approved && status.phone.startsWith('+')) status = await api.addCallNumber(phone, pin)
        if (!status.approved) throw new Error(status.reason)
        updateSaved((prev) => ({ ...prev, callPhone: status.phone }))
        return status.phone
      },
      clear: () => updateSaved((prev) => ({ ...prev, callPhone: '' })),
    },
    simulate: [
      { label: 'Calendar event detected', disabled: false, onClick: () => go('discover') },
      simulate('Van is 40 min late', (t) => api.status(t.id, 'van_eta', toLocalISO(addMinutes(t.booked_pickup, 40)))),
      // mid-window, where the plan assumes boarding (backend plan.BOARD_AFTER_START)
      simulate('Picked up on time', (t) => api.status(t.id, 'picked_up', toLocalISO(addMinutes(t.booked_pickup, 15)))),
      simulate('Picked up 45 min late', (t) => api.status(t.id, 'picked_up', toLocalISO(addMinutes(t.booked_pickup, 45)))),
      simulate('Arrived', (t) => api.status(t.id, 'arrived')),
      { label: 'Start over', disabled: false, onClick: restart },
    ],
    groups,
    graveyard,
    graveyardOpen,
    onToggleGraveyard: () => setGraveyardOpen((v) => !v),
    trip: current && {
      title: `${titleOf(current)} · ${shortDate(current.arrive_by)} ${clock(current.arrive_by)}`,
      rows: [
        ['Status', current.status],
        ['Pickup', current.booked_pickup ? clock(current.booked_pickup) : '–'],
        ['On time', odds(current) != null ? percent(odds(current)) : '–'],
        ['Minutes late', current.outlook ? String(current.outlook.minutes_late) : '–'],
        ['Grace period', current.policy ? `${current.policy.grace_minutes} min` : 'unknown'],
        ['Calls', `${current.calls_used} of ${current.permissions.max_calls}${current.permissions.may_call_appointment ? '' : ' (off)'}`],
      ],
    },
    activity: tripEvents(current)
      .filter((e) => e.kind !== 'call_progress')
      .slice(-8)
      .reverse()
      .map((e) => ({ id: e.id, time: clock(e.at), text: e.message })),
  }

  return {
    screen,
    error: s.error,
    onDismissError: () => setS((prev) => ({ ...prev, error: '' })),
    // No chat bar on screens whose only action is a forced next step.
    showBar: !['recommend', 'decision', 'loading', 'working'].includes(screen),
    // "Chat as home" is the app's main screen now — every detail/list screen
    // reached from it (the day's ride, all rides, nothing-to-plan) gets a
    // back button instead of the logo, so there's always a way back to it.
    // Screens with their own primary action (discover, recommend) instead
    // get a "Not now" link under that button — see their own onNotNow.
    topBar: ['chat', 'home', 'everyday', 'empty'].includes(screen) ? 'back' : 'logo',
    onOpenChat: () => openChat(),
    onCloseChat: screen === 'chat' ? closeChat : () => go('chatHome'),
    voice: {
      state: s.voice,
      onHoldStart: holdStart,
      onHoldEnd: holdEnd,
    },
    discover,
    recommend,
    working,
    home,
    ride,
    call,
    outcome,
    decision,
    empty,
    everyday,
    chat,
    chatHome,
    demo,
  }
}
