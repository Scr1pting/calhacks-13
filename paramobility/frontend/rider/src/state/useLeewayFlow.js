import { useCallback, useEffect, useRef, useState } from 'react'
import { api, API_BASE, streamTrip } from '../api/client.js'
import { DEMO_CLINIC_PHONE, RIDER, SKIPPED_EVENTS, upcomingAppointments } from '../mocks/calendar.js'
import { confirmBooking, requestPickupWindow } from '../mocks/paratransit.js'
import { addMinutes, clock, clockShort, isToday, percent, shortDate, toLocalISO, weekday } from '../lib/time.js'

// The rider app's logic, now backed by the Paramobility API. Screens stay
// presentational: this hook turns backend trips, activity events and chat
// messages into the view objects they render. The calendar and the EBP
// booking call are mocks (src/mocks); everything else is the real backend.

const WINDOW_MINUTES = 30 // EBP pickup windows are 30 minutes long
const STORAGE_KEY = 'leeway.v1'
const ACTIVE = ['booked', 'riding']

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
  chatTripId: null,
  back: 'home',
  draft: '',
  sending: false,
  error: '',
}

export function useLeewayFlow() {
  const [s, setS] = useState(INIT)
  const [calendar] = useState(upcomingAppointments)
  const [saved, setSaved] = useState(() => ({ links: {}, confirmations: {}, ...loadSaved() }))
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

  const linkedIds = Object.values(saved.links)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = {}
      for (const id of Object.values(saved.links)) {
        try {
          loaded[id] = await api.getTrip(id)
          const [ev, msgs] = await Promise.all([api.events(id), api.messages(id)])
          if (cancelled) return
          setEvents((prev) => ({ ...prev, [id]: ev }))
          setMessages((prev) => ({ ...prev, [id]: msgs }))
        } catch (e) {
          if (e.status !== 404) return !cancelled && fail(e)
          // the trip is gone from the backend: forget it
          updateSaved((prev) => ({
            ...prev,
            links: Object.fromEntries(Object.entries(prev.links).filter(([, t]) => t !== id)),
          }))
        }
      }
      if (cancelled) return
      setTrips(loaded)
      // Pick up where the rider left off: plans still waiting to be booked first.
      const waiting = Object.values(loaded)
        .filter((t) => ['planning', 'planned', 'failed'].includes(t.status))
        .map((t) => t.id)
      if (waiting.length) go('recommend', { queue: waiting, qi: 0 })
      else go(Object.keys(loaded).length ? 'home' : 'discover')
    })()
    return () => {
      cancelled = true
    }
  }, []) // load once; later changes arrive through the streams below

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

  const onTripMessage = useCallback((tripId, msg) => {
    setMessages((prev) => {
      const list = prev[tripId] || []
      return list.some((m) => m.id === msg.id) ? prev : { ...prev, [tripId]: [...list, msg] }
    })
  }, [])

  const streamKey = linkedIds.join(',')
  useEffect(() => {
    const closers = linkedIds.map((id) =>
      streamTrip(id, {
        onEvent: (ev) => onTripEvent(id, ev),
        onMessage: (msg) => onTripMessage(id, msg),
      }),
    )
    return () => closers.forEach((close) => close())
  }, [streamKey, onTripEvent, onTripMessage]) // streamKey stands in for linkedIds

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
          appointment: { name: a.location.name, phone: a.location.phone || '+10000000000' },
          title: a.title,
          origin: RIDER.home,
          dest: a.location.address,
          arrive_by: toLocalISO(a.start),
          certainty: 0.9,
          permissions: { may_call_appointment: !!a.location.phone, share_rider_name: true, max_calls: 3 },
        }),
      ),
    )
    setTrips((prev) => ({ ...prev, ...Object.fromEntries(created.map((t) => [t.id, t])) }))
    updateSaved((prev) => ({
      ...prev,
      links: { ...prev.links, ...Object.fromEntries(appointments.map((a, i) => [a.id, created[i].id])) },
    }))
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

  async function sendTo(tripId, text) {
    if (!text.trim() || !tripId) return
    setS((prev) => ({ ...prev, draft: '', sending: true }))
    try {
      const msgs = await api.sendMessage(tripId, text)
      msgs.forEach((m) => onTripMessage(tripId, m))
    } catch (e) {
      fail(e)
    } finally {
      setS((prev) => ({ ...prev, sending: false }))
    }
  }

  const send = (text) => !s.sending && sendTo(s.chatTripId, text)

  // ---- derived state --------------------------------------------------------

  const linked = linkedIds.map((id) => trips[id]).filter(Boolean)
  const byTime = (a, b) => new Date(a.arrive_by) - new Date(b.arrive_by)
  const booked = linked.filter((t) => ACTIVE.includes(t.status)).sort(byTime)
  const unplanned = calendar.filter((a) => !saved.links[a.id])
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

  // ---- recommend (and planning, which shows as "working") ------------------

  const recTrip = trips[s.queue[s.qi]]
  let recommend = null
  let planning = null
  if (s.screen === 'recommend' && recTrip) {
    if (recTrip.status === 'planned' && recTrip.plan) {
      const w = pickupWindow(recTrip)
      const arrive = clock(recTrip.arrive_by)
      recommend = {
        stepLabel: s.queue.length > 1 ? `APPOINTMENT ${s.qi + 1} OF ${s.queue.length}` : 'APPOINTMENT',
        headlineGray: `For ${titleOf(recTrip).toLowerCase()} on ${shortDate(recTrip.arrive_by).replace(',', '')} at ${arrive}, this gives you the best chance of arriving on time.`,
        locationName: recTrip.appointment.name,
        locationAddress: recTrip.dest,
        windowValue: windowText(w),
        dayLine: `${isToday(w.start) ? 'Today' : weekday(w.start)}. Be ready at ${clockShort(w.start)}.`,
        oddsLabel: `Chance of arriving by ${arrive}`,
        oddsValue: percent(recTrip.plan.recommended.p_on_time),
        explanation: recTrip.plan.explanation,
        onConfirm: () => startBooking(recTrip),
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
  let homeScreen = 'home'
  if (!booked.length) homeScreen = unplanned.length ? 'discover' : 'empty'
  else if (booked.length > 1 && !isToday(booked[0].arrive_by) && booked[0].status !== 'riding') homeScreen = 'everyday'

  let home = null
  if (current && pickupWindow(current)) {
    const w = pickupWindow(current)
    const riding = current.status === 'riding'
    const today = isToday(current.arrive_by)
    const appt = current.appointment.name
    const secondary = unplanned[0]
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
      hasSecondary: !!secondary && !today,
      secondary: secondary && { visitReason: secondary.title, date: shortDate(secondary.start) },
      onPlanSecondary: () => secondary && arrange([secondary]),
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
        approve: () => openChat(decTrip.id, 'Please tell them I’ll take the time they offered.'),
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
        approve: () => openChat(decTrip.id),
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

  function openChat(tripId = current?.id, text) {
    if (!tripId) return go('discover')
    setS((prev) => ({
      ...prev,
      screen: 'chat',
      chatTripId: tripId,
      back: prev.screen === 'chat' ? prev.back : prev.screen,
      draft: '',
    }))
    if (text) sendTo(tripId, text)
  }

  const thread = messages[s.chatTripId] || []
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
      'When should I be ready?',
      'What if I want to be more sure?',
      'Please don’t use my name when you call',
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
    updateSaved(() => ({ links: {}, confirmations: {} }))
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
      simulate('Picked up on time', (t) => api.status(t.id, 'picked_up', toLocalISO(t.booked_pickup))),
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

  let screen = s.screen
  if (screen === 'home') screen = homeScreen
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
