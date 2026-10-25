import { useEffect, useRef, useState } from 'react'
import {
  APPOINTMENTS,
  LOCATION,
  ALSO_BOOKED_EXTRA,
  LAST_TRIP,
  CALL_TRANSCRIPTS,
  DECISION_OPTIONS,
  CHAT_REPLIES,
  CHAT_SUGGESTIONS,
  matchChat,
} from '../data/leewayDemoData.js'
import { RIDER, checkDeviceCalendar, riderId } from '../calendar/deviceCalendar.js'
import { api } from '../api/client.js'

// Ported from the `Component` class in design-reference/Leeway Denise
// Prototype.dc.html — same state shape, same transitions, same derived
// view-model (there called renderVals()). This hook is "the logic"; every
// screen component is presentational and just renders the view object it's
// given.
//
// The discover screen lists the appointments in the rider's phone calendar
// that need a ride (the backend decides with Haiku). Arranging them plans real
// trips on the backend, and the recommendation and booking screens show those
// plans; the EBP booking call and the screens after it still run on the
// sample data.

const INIT = {
  screen: 'discover',
  phase: 0,
  sel: { neuro: true, pt: true },
  queue: [],
  qi: 0,
  booked: { neuro: false, pt: false },
  today: false,
  callPath: 'yes',
  listening: false,
  outKind: 'moved',
  choice: 'thu',
  work: 'book',
  msgs: [],
  draft: '',
  typing: false,
  back: 'home',
}

const CHAT_SAMPLE = {
  back: 'everyday',
  msgs: [
    { from: 'me', t: 'When is my next ride?' },
    { from: 'lw', k: 'next' },
    { from: 'me', t: 'Can someone ride with me?' },
    { from: 'lw', k: 'att' },
  ],
}

// "Tue, Nov 3" and "10:30 AM" in the phone's time zone, as the design writes them.
const shortDate = (v) =>
  new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const clock = (v) => new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const clockShort = (v) => clock(v).replace(/\s?[AP]M$/, '')
const weekday = (v) => new Date(v).toLocaleDateString('en-US', { weekday: 'long' })
const isToday = (v) => new Date(v).toDateString() === new Date().toDateString()

const WINDOW_MINUTES = 30 // EBP pickup windows are 30 minutes long

// A planned trip in the shape of the sample APPOINTMENTS, so the
// recommendation and booking screens render it the same way.
function recOf(trip) {
  // The booked pickup once there is one, else the recommendation.
  const options = [trip.plan.recommended, ...trip.plan.options, ...trip.plan.tradeoff]
  const at = (v) => new Date(v).getTime()
  const pick =
    (trip.booked_pickup && options.find((o) => at(o.pickup_time) === at(trip.booked_pickup))) ||
    trip.plan.recommended
  const start = new Date(pick.pickup_time)
  return {
    key: trip.id,
    visitReason: trip.title || 'Appointment',
    day: weekday(trip.arrive_by),
    date: shortDate(trip.arrive_by),
    arriveByTime: clock(trip.arrive_by),
    pickupTime: pick.pickup_time,
    pickupWindowStart: clockShort(start),
    pickupWindowEnd: clockShort(start.getTime() + WINDOW_MINUTES * 60000),
    pOnTime: trip.outlook?.p_on_time ?? pick.p_on_time,
    // MOCK: EBP's booking call isn't connected yet, so its confirmation number is made up.
    confirmationNumber: `#${(parseInt(trip.id.slice(-6), 16) % 90000) + 10000}`,
    explanation: trip.plan.explanation,
    location: { name: trip.appointment.name, address: trip.dest },
  }
}

function pendingTask(label, done, doneLabel, active) {
  return {
    label: done ? doneLabel : label,
    state: done ? 'done' : active ? 'active' : 'pending',
  }
}

export function useLeewayFlow() {
  const [s, setS] = useState(INIT)
  const replyTimer = useRef(null)
  // {calendar, skipped} from the phone's calendar; null until read, or if it can't be.
  const [cal, setCal] = useState(null)
  // Trips planned on the backend for calendar appointments, by id.
  const [trips, setTrips] = useState({})
  // Trip ids being planned after "Arrange"; the recommendations show once they're ready.
  const [arranging, setArranging] = useState(null)
  const [arrangeError, setArrangeError] = useState('')

  const go = (screen, extra = {}) =>
    setS((prev) => ({ ...prev, ...extra, screen, phase: 0 }))
  const restart = () => {
    const sel = cal?.calendar.length
      ? Object.fromEntries(cal.calendar.map((e) => [e.id, true]))
      : { ...INIT.sel }
    setS({ ...INIT, sel, booked: { ...INIT.booked } })
  }

  // One ticking interval for the flow's whole lifetime (mirrors the
  // prototype's single setInterval in componentDidMount) — it drives the
  // working-task timers, the call transcript reveal, and auto-advances
  // (call -> outcome/decision, Thursday change -> outcome).
  useEffect(() => {
    const iv = setInterval(() => {
      setS((prev) => {
        const next = { ...prev, phase: prev.phase + 1 }
        if (prev.screen === 'call' && next.phase >= 10) {
          return prev.callPath === 'yes'
            ? { ...next, screen: 'outcome', outKind: 'moved', phase: 0, listening: false }
            : { ...next, screen: 'decision', phase: 0, listening: false }
        }
        if (prev.screen === 'working' && prev.work === 'thu' && next.phase >= 5) {
          return { ...next, screen: 'outcome', outKind: 'thursday', phase: 0 }
        }
        if (prev.screen === 'working' && prev.work === 'book' && next.phase === 6) {
          next.booked = { ...prev.booked, [prev.queue[prev.qi]]: true }
        }
        return next
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => () => clearTimeout(replyTimer.current), [])

  useEffect(() => {
    let cancelled = false
    checkDeviceCalendar()
      .then((checked) => {
        if (cancelled || !checked) return
        setCal(checked)
        setS((prev) => ({
          ...prev,
          sel: Object.fromEntries(checked.calendar.map((e) => [e.id, true])),
          // Nothing in the calendar needs a ride: say so instead of listing nothing.
          screen: prev.screen === 'discover' && !checked.calendar.length ? 'empty' : prev.screen,
        }))
      })
      .catch((e) => console.warn('calendar check failed, showing sample appointments', e))
    return () => {
      cancelled = true
    }
  }, [])

  // Plan a ride for each selected calendar appointment.
  async function arrange(events) {
    setArrangeError('')
    setArranging([])
    try {
      const created = await Promise.all(
        events.map((e) =>
          api.createTrip({
            rider: { name: RIDER.name },
            appointment: { name: e.place_name || e.place_address, phone: e.place_phone },
            title: e.title,
            rider_id: riderId,
            calendar_event_id: e.id,
            origin: RIDER.home,
            dest: e.place_address,
            arrive_by: e.start,
            certainty: 0.9,
            permissions: { may_call_appointment: !!e.place_phone, share_rider_name: true, max_calls: 3 },
          }),
        ),
      )
      setTrips((prev) => ({ ...prev, ...Object.fromEntries(created.map((t) => [t.id, t])) }))
      setArranging(created.map((t) => t.id))
    } catch (e) {
      console.warn('arranging rides failed', e)
      setArranging(null)
      setArrangeError(String(e.message || e))
    }
  }

  // Check on trips still being planned every two seconds (React Native has no
  // EventSource for the backend's streams).
  const planningIds = Object.values(trips)
    .filter((t) => t.status === 'planning')
    .map((t) => t.id)
    .join(',')
  useEffect(() => {
    if (!planningIds) return
    const iv = setInterval(async () => {
      try {
        const fresh = await Promise.all(planningIds.split(',').map((id) => api.getTrip(id)))
        setTrips((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((t) => [t.id, t])) }))
      } catch (e) {
        console.warn('checking on plans failed', e)
      }
    }, 2000)
    return () => clearInterval(iv)
  }, [planningIds])

  // Once the first arranged trip is planned, show its recommendation.
  useEffect(() => {
    if (!arranging?.length) return
    const first = trips[arranging[0]]
    if (!first || first.status === 'planning') return
    if (first.status === 'failed') {
      setArrangeError(first.error || 'planning failed')
      setArranging(null)
      return
    }
    setArranging(null)
    go('recommend', { queue: arranging, qi: 0 })
  }, [arranging, trips])

  function send(text, replyKey) {
    if (!text.trim()) return
    setS((prev) => ({
      ...prev,
      msgs: [...prev.msgs, { from: 'me', t: text }],
      draft: '',
      typing: true,
    }))
    clearTimeout(replyTimer.current)
    replyTimer.current = setTimeout(() => {
      setS((prev) => ({
        ...prev,
        msgs: [...prev.msgs, { from: 'lw', k: replyKey || matchChat(text) }],
        typing: false,
      }))
    }, 900)
  }

  const toTuesday = () =>
    go('home', { today: true, booked: { ...s.booked, neuro: true } })
  const delay = (path) => () =>
    go('call', {
      callPath: path,
      today: true,
      booked: { ...s.booked, neuro: true },
      listening: false,
    })

  // --- derived view model -------------------------------------------------
  const planned = Object.fromEntries(
    Object.values(trips)
      .filter((t) => t.plan)
      .map((t) => [t.id, recOf(t)]),
  )
  const A = { ...APPOINTMENTS, ...planned }
  const n = s.phase
  const activeKey = s.queue[s.qi] || 'neuro'
  // A trip still being planned (later in the queue) shows the sample until it's ready.
  const rec = A[activeKey] || APPOINTMENTS.neuro
  const recLocation = rec.location || LOCATION

  // discover: the phone's calendar once it's been checked, else the sample appointments
  const found = cal?.calendar.length
    ? cal.calendar.map((e) => ({
        key: e.id,
        title: e.title,
        when: `${shortDate(e.start)} · ${clock(e.start)}`,
        location: e.place_name || e.place_address,
      }))
    : ['neuro', 'pt'].map((k) => ({
        key: k,
        title: A[k].visitReason,
        when: `${A[k].date} · ${A[k].arriveByTime}`,
        location: LOCATION.name,
      }))
  const selectedKeys = found.map((a) => a.key).filter((k) => s.sel[k])
  const real = !!cal?.calendar.length
  // Without the phone's calendar, the sample plans for "neuro" and "pt".
  const demoQueue = real ? ['neuro'] : selectedKeys
  const discover = {
    items: found.map((a) => ({
      ...a,
      selected: !!s.sel[a.key],
      onToggle: () => setS((prev) => ({ ...prev, sel: { ...prev.sel, [a.key]: !prev.sel[a.key] } })),
    })),
    skipped: cal ? cal.skipped : 4,
    arrangeLabel: arranging
      ? 'Arranging…'
      : arrangeError
        ? 'Couldn’t plan that. Try again'
        : selectedKeys.length
          ? `Arrange rides (${selectedKeys.length})`
          : 'Select an appointment',
    arrangeDisabled: !!arranging || selectedKeys.length === 0,
    onArrange: () => {
      if (!selectedKeys.length) return
      if (real) arrange(cal.calendar.filter((e) => s.sel[e.id]))
      else go('recommend', { queue: selectedKeys, qi: 0 })
    },
  }

  // recommend
  const recommend = {
    stepLabel:
      s.queue.length > 1 ? `APPOINTMENT ${s.qi + 1} OF ${s.queue.length}` : 'APPOINTMENT',
    headlineGray: `For ${rec.visitReason.toLowerCase()} on ${rec.date.replace(',', '')} at ${rec.arriveByTime}, this gives you the best chance of arriving on time.`,
    locationName: recLocation.name,
    locationAddress: recLocation.address,
    windowValue: `${rec.pickupWindowStart} – ${rec.pickupWindowEnd}`,
    dayLine: `${rec.day}. Be ready at ${rec.pickupWindowStart}.`,
    oddsLabel: `Chance of arriving by ${rec.arriveByTime}`,
    oddsValue: `${Math.round(rec.pOnTime * 100)}%`,
    explanation: rec.explanation,
    onConfirm: async () => {
      if (rec.pickupTime) {
        try {
          const t = await api.book(rec.key, rec.pickupTime)
          setTrips((prev) => ({ ...prev, [t.id]: t }))
        } catch (e) {
          console.warn('booking failed', e)
          return
        }
      }
      go('working', { work: 'book' })
    },
  }

  // working
  let working = null
  {
    let headlineLead = ''
    let headlineGray = ''
    let tasks = []
    let done = false
    let nextLabel = ''
    let onNext = () => {}
    if (s.work === 'book') {
      done = n >= 6
      headlineLead = done ? `Booked for ${rec.day}.` : 'Calling East Bay Paratransit.'
      headlineGray = done
        ? `EBP confirmed your pickup window. Be ready at ${rec.pickupWindowStart}.`
        : 'Nothing is booked until they confirm. You can leave the app.'
      tasks = [
        pendingTask('Calling reservations', n >= 2, 'Connected to EBP reservations', true),
        pendingTask(
          `Requesting ${rec.pickupWindowStart} – ${rec.pickupWindowEnd}`,
          n >= 4,
          `Pickup window ${rec.pickupWindowStart} – ${rec.pickupWindowEnd} accepted`,
          n >= 2,
        ),
        pendingTask('Waiting for confirmation', n >= 6, `Confirmation ${rec.confirmationNumber}`, n >= 4),
      ]
      const more = s.qi + 1 < s.queue.length
      const next = more && (A[s.queue[s.qi + 1]] || trips[s.queue[s.qi + 1]])
      nextLabel = more ? `Next: ${next?.visitReason || next?.title || 'Appointment'}` : 'Done'
      onNext = () =>
        more ? go('recommend', { qi: s.qi + 1 }) : go('home', { today: false })
    } else if (s.work === 'thu') {
      headlineLead = 'Moving you to Thursday.'
      headlineGray =
        'I’m confirming with Kaiser, then cancelling today’s ride so it isn’t a no-show.'
      tasks = [
        pendingTask('Asking Kaiser for Thursday, 9:00 AM', n >= 2, 'Kaiser confirmed Thursday, 9:00 AM', true),
        pendingTask('Cancelling today’s EBP ride', n >= 4, 'EBP cancelled ride #48213', n >= 2),
      ]
    } else {
      headlineLead = 'Checking accessible rides.'
      headlineGray =
        'I’ll show you what’s available and what it costs. Nothing is booked until you approve.'
      tasks = [
        pendingTask('Checking wheelchair-accessible options', false, '', true),
        pendingTask('Comparing arrival times with 10:30', false, '', false),
      ]
      done = true
      nextLabel = 'Back to options'
      onNext = () => go('decision')
    }
    working = { headlineLead, headlineGray, tasks, done, nextLabel, onNext }
  }

  // home (screens 3 / 3b): the soonest ride booked on the backend, else the sample
  const bookedTrip = Object.values(trips)
    .filter((t) => t.plan && ['booked', 'riding'].includes(t.status))
    .sort((a, b) => new Date(a.arrive_by) - new Date(b.arrive_by))[0]
  // The next calendar appointment that has no ride yet.
  const unplannedEvent = real
    ? cal.calendar.find((e) => !Object.values(trips).some((t) => t.calendar_event_id === e.id))
    : null
  const bookedKey = bookedTrip ? bookedTrip.id : s.booked.neuro ? 'neuro' : s.booked.pt ? 'pt' : 'neuro'
  const homeAppt = A[bookedKey]
  const homeLocation = homeAppt.location || LOCATION
  const homeToday = bookedTrip ? isToday(bookedTrip.arrive_by) : s.today
  const secondaryKey = bookedTrip ? null : ['neuro', 'pt'].find((k) => k !== bookedKey && !s.booked[k])
  const secondary = bookedTrip
    ? unplannedEvent && { visitReason: unplannedEvent.title, date: shortDate(unplannedEvent.start) }
    : secondaryKey && A[secondaryKey]
  const home = {
    today: homeToday,
    headlineLead: homeToday
      ? `Be ready downstairs at ${homeAppt.pickupWindowStart}.`
      : `You’re set for ${homeAppt.day}.`,
    headlineGray: homeToday
      ? `Your ride to ${homeAppt.visitReason.toLowerCase()} picks you up between ${homeAppt.pickupWindowStart} and ${homeAppt.pickupWindowEnd}. Wait from the start of the window.`
      : `Be ready downstairs at ${homeAppt.pickupWindowStart}. EBP confirmed your pickup window.`,
    oddsEyebrow: `Chance of arriving by ${homeAppt.arriveByTime}`,
    oddsValue: `${Math.round(homeAppt.pOnTime * 100)}%`,
    pickupWindow: `${homeAppt.pickupWindowStart} – ${homeAppt.pickupWindowEnd}`,
    locationName: homeLocation.name,
    locationAddress: homeLocation.address,
    monitorText: homeToday
      ? `I’m watching this trip. If it starts to look late, I’ll call ${homeLocation.name.split(' ')[0]} for you.`
      : `I’ll remind you the night before and watch the trip on ${homeAppt.day}.`,
    hasSecondary: !!secondary && !homeToday,
    secondary: secondary || null,
    onPlanSecondary: () =>
      bookedTrip
        ? unplannedEvent && arrange([unplannedEvent])
        : go('recommend', { queue: [secondaryKey], qi: 0 }),
  }

  // call
  const transcript = CALL_TRANSCRIPTS[s.callPath]
  const shown = Math.min(4, Math.floor(n / 2.5) + 1)
  const waitingFor =
    shown >= 4
      ? 'Call finished. Updating your plan.'
      : shown >= 2
        ? 'Waiting for: whether Dr. Patel can see you after 10:45.'
        : 'Waiting for: the front desk to pick up the request.'
  const call = {
    headlineLead: 'You may be 15 minutes late.',
    headlineGray: `I’m calling ${LOCATION.name} to ask if they can still see you.`,
    statusLabel: s.listening ? 'Listening in' : shown >= 4 ? 'Call ended' : 'On a call',
    callTime: `${Math.floor((n * 4) / 60)}:${String((n * 4) % 60).padStart(2, '0')}`,
    lines: transcript
      .slice(0, shown)
      .slice(-2)
      .map((l) => ({ ...l, tone: l.who === 'LEEWAY' ? 'accent' : 'secondary' })),
    waitingFor,
    listening: s.listening,
    listenLabel: s.listening ? 'Stop listening' : 'Listen in',
    onToggleListen: () => setS((prev) => ({ ...prev, listening: !prev.listening })),
  }

  // outcome
  const outcome =
    s.outKind === 'moved'
      ? {
          headlineLead: 'Kaiser moved you to 11:00 AM.',
          headlineGray: 'Same doctor. Keep waiting downstairs; your ride is still coming.',
          was: '10:30',
          now: '11:00 AM',
          detail: 'Neurology with Dr. Patel. Confirmed by the front desk at 9:24 AM.',
          oddsLabel: 'Chance of arriving by 11:00',
          oddsValue: '91%',
          oddsColor: 'var(--lw-success)',
          showLocation: true,
          locationName: LOCATION.name,
          locationAddress: LOCATION.address,
          firstLabel: 'View calendar',
          onFirst: () => {},
        }
      : {
          headlineLead: 'You’re moved to Thursday, 9:00 AM.',
          headlineGray: 'Same doctor. Today’s ride is cancelled, so it won’t count as a no-show.',
          was: 'Tue 10:30',
          now: 'Thu 9:00 AM',
          detail: 'Kaiser confirmed at 9:31 AM. EBP cancelled ride #48213.',
          oddsLabel: 'Ride for Thursday',
          oddsValue: 'Not booked yet',
          oddsColor: 'var(--lw-text-secondary)',
          showLocation: false,
          firstLabel: 'Plan Thursday’s ride',
          onFirst: () => go('recommend', { queue: ['neuro'], qi: 0 }),
        }

  // decision
  const decision = {
    options: DECISION_OPTIONS.map((o) => ({
      ...o,
      selected: s.choice === o.key,
      onSelect: () => setS((prev) => ({ ...prev, choice: o.key })),
    })),
    approveLabel: DECISION_OPTIONS.find((o) => o.key === s.choice).label,
    onApprove: () =>
      s.choice === 'thu'
        ? go('working', { work: 'thu' })
        : s.choice === 'car'
          ? go('working', { work: 'car' })
          : go('home', { today: true }),
  }

  // empty / everyday
  const empty = { lastTrip: LAST_TRIP, onRestart: restart }
  const everyday = {
    next: {
      title: A.neuro.visitReason,
      location: LOCATION.name,
      date: A.neuro.date.toUpperCase(),
      oddsValue: `${Math.round(A.neuro.pOnTime * 100)}%`,
      arriveByTime: A.neuro.arriveByTime,
      pickupWindow: `${A.neuro.pickupWindowStart} – ${A.neuro.pickupWindowEnd}`,
    },
    alsoBooked: ALSO_BOOKED_EXTRA,
  }

  // chat
  const chatMessages = s.msgs.map((m, i) => {
    const reply = m.from === 'lw' ? CHAT_REPLIES[m.k] : null
    const isLast = i === s.msgs.length - 1 && !s.typing
    return {
      isMe: m.from === 'me',
      text: reply ? reply.text : m.t,
      hasCard: !!(reply && reply.card),
      hasActions: !!(reply && reply.actions && isLast),
      actions: reply?.actions
        ? reply.actions.map(([label, replyKey], j) => ({
            label,
            variant: j === 0 ? 'compact-solid' : 'compact-outline',
            onClick: () => send(label, replyKey),
          }))
        : [],
    }
  })
  const chat = {
    isEmpty: !s.msgs.length && !s.typing,
    messages: chatMessages,
    rideCard: {
      eyebrow: `Pickup window · ${A.neuro.date.toUpperCase()}`,
      window: `${A.neuro.pickupWindowStart} – ${A.neuro.pickupWindowEnd}`,
      subtitle: `${A.neuro.visitReason}, ${LOCATION.name}`,
      oddsLabel: `Chance of arriving by ${A.neuro.arriveByTime}`,
      oddsValue: `${Math.round(A.neuro.pOnTime * 100)}%`,
    },
    typing: s.typing,
    suggestions: CHAT_SUGGESTIONS.map(([q, k]) => ({ text: q, onClick: () => send(q, k) })),
    draft: s.draft,
    onDraftChange: (value) => setS((prev) => ({ ...prev, draft: value })),
    onSend: () => send(s.draft),
    onEnter: (e) => {
      if (e.key === 'Enter') send(s.draft)
    },
  }

  const openChat = () =>
    go('chat', { msgs: [], draft: '', typing: false, back: s.screen })
  const closeChat = () => go(s.back || 'home', { typing: false })

  // --- demo navigation (mirrors the prototype's side "simulate" panel) ---
  const jumpTargets = {
    discover: () => restart(),
    recommend: () => go('recommend', { queue: demoQueue.length ? demoQueue : ['neuro'], qi: 0 }),
    booking: () => go('working', { work: 'book', queue: s.queue.length ? s.queue : ['neuro'] }),
    homeB: () => go('home', { today: false, booked: { neuro: true, pt: false } }),
    homeC: toTuesday,
    call: delay('yes'),
    outcome: () => go('outcome', { outKind: 'moved', today: true }),
    callNo: delay('no'),
    decision: () => go('decision', { today: true }),
    workThu: () => go('working', { work: 'thu', today: true }),
    outThu: () => go('outcome', { outKind: 'thursday', today: true }),
    empty: () => go('empty', { today: false }),
    everyday: () => go('everyday', { today: false }),
    chatNew: () => go('chat', { msgs: [], typing: false, back: s.screen === 'chat' ? s.back : s.screen }),
    chat: () => go('chat', { ...CHAT_SAMPLE, typing: false, back: s.screen === 'chat' ? s.back : s.screen }),
  }
  const activeStepKey =
    s.screen === 'home'
      ? s.today
        ? 'homeC'
        : 'homeB'
      : s.screen === 'call'
        ? s.callPath === 'yes'
          ? 'call'
          : 'callNo'
        : s.screen === 'outcome'
          ? s.outKind === 'moved'
            ? 'outcome'
            : 'outThu'
          : s.screen === 'working'
            ? s.work === 'book'
              ? 'booking'
              : s.work === 'thu'
                ? 'workThu'
                : 'decision'
            : s.screen === 'chat'
              ? s.msgs.length
                ? 'chat'
                : 'chatNew'
              : s.screen
  const stepGroups = [
    { title: 'Planning', steps: [['discover', '1', 'Calendar discovery'], ['recommend', '2', 'Recommended booking'], ['booking', '2b', 'Leeway books with EBP']] },
    { title: 'Home', steps: [['empty', '3a', 'Nothing to plan'], ['everyday', '3c', 'Everyday home'], ['homeB', '3', 'Ride booked, future day'], ['homeC', '3b', 'Day of ride']] },
    { title: 'Ride at risk', steps: [['call', '4', 'Calling the clinic'], ['outcome', '5', 'Rescheduled']] },
    { title: 'Clinic can’t move it', steps: [['callNo', '4b', 'Calling the clinic'], ['decision', '6', 'Rider decision'], ['workThu', '6b', 'Leeway makes the change'], ['outThu', '6c', 'Moved to Thursday']] },
    { title: 'Ask Leeway', steps: [['chatNew', '7', 'New chat'], ['chat', '7b', 'Conversation']] },
  ].map((g) => ({
    title: g.title,
    steps: g.steps.map(([stepKey, num, label]) => ({
      key: stepKey,
      num,
      label,
      active: activeStepKey === stepKey,
      onClick: jumpTargets[stepKey],
    })),
  }))
  const simulate = [
    { label: 'It’s Tuesday morning', onClick: toTuesday },
    { label: 'EBP delay notice · clinic says yes', onClick: delay('yes') },
    { label: 'EBP delay notice · clinic says no', onClick: delay('no') },
    { label: 'Restart', onClick: restart },
  ]

  return {
    screen: s.screen,
    showBar: s.screen !== 'recommend' && s.screen !== 'decision',
    topBar: s.screen === 'chat' ? 'back' : 'logo',
    onOpenChat: openChat,
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
    stepGroups,
    simulate,
  }
}
