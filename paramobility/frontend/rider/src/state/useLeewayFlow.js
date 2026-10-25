import { useCallback, useEffect, useRef, useState } from 'react'
import { api, API_BASE, streamRider, streamTrip } from '../api/client.js'
import { DEMO_CLINIC_PHONE, RIDER, SKIPPED_EVENTS, upcomingAppointments } from '../mocks/calendar.js'
import { confirmBooking, requestPickupWindow } from '../mocks/paratransit.js'
import { playAudio, startRecording } from '../lib/recorder.js'
import { addMinutes, clock, clockShort, isToday, percent, shortDate, toLocalISO, weekday } from '../lib/time.js'

// The rider app's logic, backed by the Paramobility API. Screens stay
// presentational: this hook turns the rider's trips, activity events and
// conversation with Leeway into the view objects they render. The calendar
// and the EBP booking call are mocks (src/mocks); everything else is the real
// backend, including talking to Leeway by voice.

const WINDOW_MINUTES = 30 // EBP pickup windows are 30 minutes long
const STORAGE_KEY = 'leeway.v2'
const ACTIVE = ['booked', 'riding']
const WAITING = ['planning', 'planned', 'failed']

const newRiderId = () => `rider_${Math.random().toString(36).slice(2, 12)}`

// The rider profile the backend keeps: who they are, where pickups start,
// and their (mock) calendar, so Leeway can talk about all of it.
function riderProfile(calendar) {
  return {
    name: RIDER.name,
    home: RIDER.home,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    calendar: calendar.map((a) => ({
      id: a.id,
      title: a.title,
      start: toLocalISO(a.start),
      place_name: a.location.name,
      place_address: a.location.address,
      place_phone: a.location.phone,
    })),
    permissions: { may_call_appointment: !!DEMO_CLINIC_PHONE, share_rider_name: true, max_calls: 3 },
  }
}

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
  showTranscript: false,
  back: 'home',
  voice: 'idle', // idle | listening | thinking | speaking
  draft: '',
  sending: false,
  error: '',
}

export function useLeewayFlow() {
  const [s, setS] = useState(INIT)
  const [calendar] = useState(upcomingAppointments)
  const [saved, setSaved] = useState(() => {
    const data = { confirmations: {}, ...loadSaved() }
    if (!data.riderId) {
      data.riderId = newRiderId()
      save(data)
    }
    return data
  })
  const riderId = saved.riderId
  const voiceRef = useRef({ stop: null, stopAudio: null })
  const [trips, setTrips] = useState({})
  const [events, setEvents] = useState({})
  const [messages, setMessages] = useState({})
  const [now, setNow] = useState(Date.now())
  const tripsRef = useRef(trips)
  tripsRef.current = trips

  const go = (screen, extra = {}) => setS((prev) => ({ ...prev, ...extra, screen }))
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
        // Sync the profile and calendar, then load everything Leeway knows.
        await api.putRider(riderId, riderProfile(calendar))
        const [list, thread] = await Promise.all([api.riderTrips(riderId), api.riderMessages(riderId)])
        const evs = await Promise.all(list.map((t) => api.events(t.id)))
        if (cancelled) return
        setEvents(Object.fromEntries(list.map((t, i) => [t.id, evs[i]])))
        setMessages({ [riderId]: thread })
        setTrips(Object.fromEntries(list.map((t) => [t.id, t])))
        // Pick up where the rider left off: plans still waiting to be booked first.
        const waiting = list.filter((t) => WAITING.includes(t.status)).map((t) => t.id)
        if (waiting.length) go('recommend', { queue: waiting, qi: 0 })
        else go(list.length ? 'home' : 'discover')
      } catch (e) {
        if (!cancelled) fail(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [riderId, calendar]) // later changes arrive through the streams below

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

  useEffect(() => streamRider(riderId, { onMessage, onTrip }), [riderId, onMessage, onTrip])

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

  async function arrange(appointments) {
    try {
      setS((prev) => ({ ...prev, error: '' }))
      const ids = await createTrips(appointments)
      go('recommend', { queue: ids, qi: 0 })
    } catch (e) {
      fail(e)
    }
  }

  async function startBooking(trip) {
    go('working', { booking: { tripId: trip.id, step: 0 } })
    const step = (n, extra = {}) =>
      setS((prev) => ({ ...prev, booking: { ...prev.booking, step: n, ...extra } }))
    try {
      await requestPickupWindow(step)
      await api.book(trip.id, trip.plan.recommended.pickup_time)
      const confirmation = await confirmBooking()
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
    voiceRef.current.stopAudio?.()
    if (voiceRef.current.stop || s.voice === 'thinking') return
    try {
      voiceRef.current.stop = await startRecording()
      setVoice('listening')
    } catch (e) {
      voiceRef.current.stop = null
      fail(new Error(`I can't use the microphone: ${e.message}`))
    }
  }

  async function holdEnd() {
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
  const windowText = (w) => `${clockShort(w.start)} – ${clockShort(w.end)}`
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
    skipped: SKIPPED_EVENTS,
    arrangeLabel: selectedApps.length ? `Arrange rides (${selectedApps.length})` : 'Select an appointment',
    arrangeDisabled: selectedApps.length === 0,
    onArrange: () => selectedApps.length && arrange(selectedApps),
  }

  // ---- which home screen ------------------------------------------------------

  let homeScreen = 'home'
  if (!booked.length) homeScreen = waiting.length ? 'recommend' : unplanned.length ? 'discover' : 'empty'
  else if (booked.length > 1 && !isToday(booked[0].arrive_by) && booked[0].status !== 'riding') homeScreen = 'everyday'
  const viewScreen = s.screen === 'home' ? homeScreen : s.screen

  // ---- recommend (and planning, which shows as "working") ------------------

  // From home, a plan that's waiting to be booked: show the next one.
  const fromQueue = s.screen === 'recommend' && s.queue.length > 0
  const queue = fromQueue ? s.queue : waiting.map((t) => t.id)
  const qi = fromQueue ? s.qi : 0
  const recTrip = trips[queue[qi]]
  let recommend = null
  let planning = null
  if (viewScreen === 'recommend' && recTrip) {
    if (recTrip.status === 'planned' && recTrip.plan) {
      const w = pickupWindow(recTrip)
      const arrive = clock(recTrip.arrive_by)
      recommend = {
        stepLabel: queue.length > 1 ? `APPOINTMENT ${qi + 1} OF ${queue.length}` : 'APPOINTMENT',
        headlineGray: `For ${titleOf(recTrip).toLowerCase()} on ${shortDate(recTrip.arrive_by).replace(',', '')} at ${arrive}, this gives you the best chance of arriving on time.`,
        locationName: recTrip.appointment.name,
        locationAddress: recTrip.dest,
        windowValue: windowText(w),
        dayLine: `${isToday(w.start) ? 'Today' : weekday(w.start)}. Be ready at ${clockShort(w.start)}.`,
        oddsLabel: `Chance of arriving by ${arrive}`,
        oddsValue: percent(recTrip.plan.recommended.p_on_time),
        explanation: recTrip.plan.explanation,
        onConfirm: () => {
          if (!fromQueue) go('recommend', { queue, qi })
          startBooking(recTrip)
        },
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
    }
  }

  // ---- working: booking with EBP --------------------------------------------

  let working = planning
  if (s.screen === 'working' && s.booking) {
    const t = trips[s.booking.tripId]
    const w = t && pickupWindow(t)
    const step = s.booking.step
    const done = step >= 3
    const more = s.qi + 1 < s.queue.length && s.queue[s.qi] === s.booking.tripId
    const nextTrip = more ? trips[s.queue[s.qi + 1]] : null
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
            ? `EBP confirmed your pickup window. Be ready at ${clockShort(w.start)}.`
            : 'Nothing is booked until they confirm. You can leave the app.',
          tasks: [
            pendingTask('Calling reservations', step >= 1, 'Connected to EBP reservations', true),
            pendingTask(`Requesting ${windowText(w)}`, step >= 2, `Pickup window ${windowText(w)} accepted`, step >= 1),
            pendingTask('Waiting for confirmation', done, `Confirmation ${s.booking.confirmation}`, step >= 2),
          ],
          done,
          nextLabel: nextTrip ? `Next: ${titleOf(nextTrip)}` : 'Done',
          onNext: () => (nextTrip ? go('recommend', { qi: s.qi + 1, booking: null }) : go('home', { booking: null })),
        }
  }

  // ---- home -----------------------------------------------------------------

  const lastTripDone = linked.filter((t) => t.status === 'completed').sort(byTime).at(-1)

  let home = null
  if (current && pickupWindow(current)) {
    const w = pickupWindow(current)
    const riding = current.status === 'riding'
    const today = isToday(current.arrive_by)
    const appt = current.appointment.name
    // Another appointment that needs attention: a plan to review, or one with no ride yet.
    const review = waiting.find((t) => t.status === 'planned')
    const secondary = review
      ? {
          visitReason: titleOf(review),
          date: shortDate(review.arrive_by),
          sub: 'Plan ready',
          action: 'Review',
          onClick: () => go('recommend', { queue: [review.id], qi: 0 }),
        }
      : unplanned[0] && {
          visitReason: unplanned[0].title,
          date: shortDate(unplanned[0].start),
          sub: 'Needs a ride',
          action: 'Plan',
          onClick: () => arrange([unplanned[0]]),
        }
    home = {
      today,
      headlineLead: riding
        ? 'You’re on your way.'
        : today
          ? `Be ready downstairs at ${clockShort(w.start)}.`
          : `You’re set for ${weekday(current.arrive_by)}.`,
      headlineGray: riding
        ? `I’m watching the trip. If it starts to look late, I’ll call ${firstWord(appt)} for you.`
        : today
          ? `Your ride to ${titleOf(current).toLowerCase()} picks you up between ${clockShort(w.start)} and ${clockShort(w.end)}. Wait from the start of the window.`
          : `Be ready downstairs at ${clockShort(w.start)}. EBP confirmed your pickup window.`,
      oddsEyebrow: `Chance of arriving by ${clock(current.arrive_by)}`,
      oddsValue: odds(current) != null ? percent(odds(current)) : '–',
      pickupWindow: windowText(w),
      locationName: appt,
      locationAddress: current.dest,
      monitorText: riding || today
        ? `I’m watching this trip. If it starts to look late, I’ll call ${firstWord(appt)} for you.`
        : `I’ll watch the trip on ${weekday(current.arrive_by)}.`,
      hasSecondary: !!secondary && !riding,
      secondary,
      onPlanSecondary: () => secondary?.onClick(),
    }
  }

  const everyday = booked.length
    ? {
        next: {
          title: titleOf(booked[0]),
          day: weekday(booked[0].arrive_by),
          location: booked[0].appointment.name,
          date: shortDate(booked[0].arrive_by).toUpperCase(),
          oddsValue: odds(booked[0]) != null ? percent(odds(booked[0])) : '–',
          arriveByTime: clock(booked[0].arrive_by),
          pickupWindow: windowText(pickupWindow(booked[0])),
        },
        alsoBooked: booked.slice(1).map((t) => ({
          title: titleOf(t),
          date: `${shortDate(t.arrive_by)} · ${clock(t.arrive_by)}`,
          oddsText: odds(t) != null ? percent(odds(t)) : '–',
        })),
      }
    : null

  const empty = {
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
  if (s.screen === 'call' && callTrip) {
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
  if (s.screen === 'outcome' && outTrip) {
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
      oddsColor: 'var(--lw-success)',
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
        was: s.outcome.was ? clockShort(s.outcome.was) : '',
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
  if (s.screen === 'decision' && decTrip) {
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
    ].map((q) => ({ text: q, onClick: () => send(q) })),
    draft: s.draft,
    onDraftChange: (value) => setS((prev) => ({ ...prev, draft: value })),
    onSend: () => send(s.draft),
    onEnter: (e) => {
      if (e.key === 'Enter') send(s.draft)
    },
  }
  const closeChat = () => go(s.back === 'chat' ? 'home' : s.back || 'home')

  // ---- demo panel: live state and simulated ride updates -----------------------

  const restart = () => {
    voiceRef.current.stopAudio?.()
    updateSaved(() => ({ riderId: newRiderId(), confirmations: {} }))
    setTrips({})
    setEvents({})
    setMessages({})
    setS({ ...INIT, screen: 'discover' })
  }
  const simTrip = booked[0]
  const simulate = (label, run) => ({
    label,
    disabled: !simTrip,
    onClick: () => simTrip && run(simTrip).then(() => refreshTrip(simTrip.id)).catch(fail),
  })
  const demo = {
    apiBase: API_BASE,
    callsEnabled: !!DEMO_CLINIC_PHONE,
    simulate: [
      simulate('Van is 40 min late', (t) => api.status(t.id, 'van_eta', toLocalISO(addMinutes(t.booked_pickup, 40)))),
      // mid-window, where the plan assumes boarding (backend plan.BOARD_AFTER_START)
      simulate('Picked up on time', (t) => api.status(t.id, 'picked_up', toLocalISO(addMinutes(t.booked_pickup, 15)))),
      simulate('Picked up 45 min late', (t) => api.status(t.id, 'picked_up', toLocalISO(addMinutes(t.booked_pickup, 45)))),
      simulate('Arrived', (t) => api.status(t.id, 'arrived')),
      { label: 'Start over', disabled: false, onClick: restart },
    ],
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

  // ---- which screen to show ----------------------------------------------------

  let screen = viewScreen
  if (screen === 'recommend' && (planning || !recommend)) screen = recTrip ? 'working' : 'loading'
  if (screen === 'home' && !home) screen = 'loading'
  if (screen === 'everyday' && !everyday) screen = 'loading'

  return {
    screen,
    error: s.error,
    onDismissError: () => setS((prev) => ({ ...prev, error: '' })),
    showBar: !['recommend', 'decision', 'loading'].includes(screen),
    topBar: screen === 'chat' ? 'back' : 'logo',
    onOpenChat: () => openChat(),
    onCloseChat: closeChat,
    voice: {
      state: s.voice,
      onHoldStart: holdStart,
      onHoldEnd: holdEnd,
    },
    discover,
    recommend,
    working,
    home,
    call,
    outcome,
    decision,
    empty,
    everyday,
    chat,
    demo,
  }
}
