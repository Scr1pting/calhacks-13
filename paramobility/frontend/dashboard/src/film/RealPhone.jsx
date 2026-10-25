import { useEffect, useMemo, useState } from 'react'
import { clock } from '../sim/fleet.js'
import { forecast } from './forecast.js'
import { liveCall } from './liveCall.js'
// The rider app's own screens, so the phone in the film is the real app.
import '../../../rider/src/tokens.css'
import PhoneShell from '../../../rider/src/components/PhoneShell.jsx'
import AskLeewayBar from '../../../rider/src/components/AskLeewayBar.jsx'
import HomeScreen from '../../../rider/src/screens/HomeScreen.jsx'
import LiveTripScreen from '../../../rider/src/screens/LiveTripScreen.jsx'
import RiderDecisionScreen from '../../../rider/src/screens/RiderDecisionScreen.jsx'
import CallingClinicScreen from '../../../rider/src/screens/CallingClinicScreen.jsx'
import OutcomeScreen from '../../../rider/src/screens/OutcomeScreen.jsx'
import { oddsColor } from '../../../rider/src/lib/time.js'

// Maria's phone in the live story: the rider app's screens, given the view
// models the app would build for this ride at this moment, in its own words.
// Buttons do nothing here; the story drives the phone.

const hm = (t) => clock(t).replace(/ [AP]M$/, '')
const pct = (p) => `${Math.round(p * 100)}%`
const noop = () => {}
const PHONE_H = 844

// The phone's size: as tall as the screen allows, at most life size.
export function usePhoneScale() {
  const fit = () => Math.min(1, (window.innerHeight - 80) / PHONE_H)
  const [scale, setScale] = useState(fit)
  useEffect(() => {
    const onResize = () => setScale(fit())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}

export function useCall() {
  const [call, setCall] = useState(liveCall.get())
  useEffect(() => liveCall.subscribe(setCall), [])
  // The call timer ticks while the call runs.
  const [, tick] = useState(0)
  useEffect(() => {
    if (call.status === 'done' || call.status === 'failed' || call.status === 'idle') return undefined
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [call.status])
  return call
}

export default function RealPhone({ live, scene, since, t, moved }) {
  const scale = usePhoneScale()
  const call = useCall()
  const screen = scene.phone || 'off'
  const { ride } = live
  // [lat, lng], as the app's map wants them; made once so the map keeps it.
  const route = useMemo(() => ride.route.map((r) => [r.pos[1], r.pos[0]]), [ride])
  const destination = useMemo(() => [ride.dropoff.pos[1], ride.dropoff.pos[0]], [ride])
  const clinicName = live.clinic.split(',')[0]
  const town = live.clinic.split(',')[1]?.trim() || ''
  const by = moved ? live.newAppointment : live.appointment
  const lines = call.lines.map((l) => ({
    who: l.role === 'agent' ? 'LEEWAY' : 'FRONT DESK',
    t: l.text,
    tone: l.role === 'agent' ? 'accent' : 'secondary',
  }))

  let body = null
  let bar = true
  if (screen === 'home') {
    const p = forecast(ride, ride.depart, live.appointment).pOnTime
    body = (
      <HomeScreen
        home={{
          headlineLead: 'Your ride is booked.',
          headlineGray: `The van comes between ${ride.pickup.window[0]} and ${ride.pickup.window[1]} for your ${live.appointmentLabel} appointment.`,
          oddsEyebrow: `Chance of arriving by ${live.appointmentLabel}`,
          oddsValue: pct(p),
          oddsColor: oddsColor(p),
          pickupWindow: `${ride.pickup.window[0]} – ${ride.pickup.window[1]}`,
          locationName: clinicName,
          locationAddress: town,
          monitorText: 'I’ll watch the van and tell you if anything changes.',
          hasSecondary: false,
        }}
      />
    )
  } else if (screen === 'arriving' || screen === 'ride' || screen === 'arrived') {
    const f = forecast(ride, t, by)
    const start = forecast(ride, ride.depart, by).pOnTime
    const arrived = !f.sigma
    const behind = t + f.median - ride.plannedDrop
    const here = t >= ride.pickup.t
    body = (
      <LiveTripScreen
        ride={{
          headlineLead: arrived ? 'You’ve arrived.' : here ? 'You’re on your way.' : 'Your van is almost here.',
          headlineGray: arrived
            ? `${Math.round(live.newAppointment - ride.dropoff.t)} minutes before your appointment.`
            : here
              ? `Picked up at ${hm(ride.pickup.t)}. I’m watching this trip and will update your chance of arriving on time.`
              : `It’s due at ${hm(ride.pickup.t)}.`,
          mapLabel: `Map of your ride to ${clinicName}`,
          progress: f.done / ride.total,
          heavyTraffic: !arrived && behind >= 10,
          route,
          destination,
          label: `Chance of arriving by ${clock(by)}`,
          big: pct(f.pOnTime),
          color: oddsColor(f.pOnTime),
          delta: Math.abs(f.pOnTime - start) < 0.005 ? 'Live' : `${f.pOnTime < start ? 'Down' : 'Up'} from ${pct(start)}`,
          reason: arrived
            ? `Arrived at ${hm(ride.dropoff.t)}.`
            : behind >= 10
              ? `Traffic is slowing the van down. Likely arrival ${hm(f.low)}–${hm(f.high)}.`
              : `Likely arrival ${hm(f.low)}–${hm(f.high)}.`,
          rowLabel: `Distance to ${clinicName}`,
          rowValue: `${(f.left * 0.6214).toFixed(1)} mi`,
        }}
      />
    )
  } else if (screen === 'ask') {
    const f = forecast(ride, t, live.appointment)
    bar = false
    body = (
      <RiderDecisionScreen
        decision={{
          headlineLead: 'You’ll likely be late.',
          headlineGray: `Traffic is holding the van up. You’ll arrive around ${hm(t + f.median)}, after your ${live.appointmentLabel} appointment. What should I do?`,
          options: [
            { key: 'move', title: `Move it to ${live.newAppointmentLabel}`, sub: `I’ll call ${clinicName} and ask.`, tag: 'Recommended', selected: true, onSelect: noop },
            { key: 'tell', title: `Keep ${live.appointmentLabel}`, sub: 'I’ll tell them you’re running late.', selected: false, onSelect: noop },
            { key: 'none', title: 'Do nothing', sub: 'I’ll keep watching the van.', selected: false, onSelect: noop },
          ],
          approveLabel: `Call ${clinicName}`,
          onApprove: noop,
        }}
      />
    )
  } else if (screen === 'call') {
    // How late she could be, from the late end of the forecast when Leeway decided to call.
    const late = Math.max(2, Math.round(forecast(ride, live.alarm, live.appointment).high - live.appointment))
    const secs = call.startedAt ? Math.floor((performance.now() - call.startedAt) / 1000) : 0
    const ended = call.status === 'done' || call.status === 'failed'
    bar = false
    body = (
      <CallingClinicScreen
        call={{
          headlineLead: `You may be up to ${late} minutes late.`,
          headlineGray: `I’m calling ${clinicName} to move your appointment to ${live.newAppointmentLabel}.`,
          statusLabel: ended ? 'Call ended' : call.status === 'talking' ? 'On a call' : call.status === 'ringing' ? 'Ringing' : 'Calling',
          callTime: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
          lines: lines.slice(-3),
          waitingFor: ended
            ? 'Call finished. Updating your plan.'
            : lines.length
              ? `Waiting for: whether ${live.newAppointmentLabel} works.`
              : 'Waiting for: the front desk to pick up.',
        }}
      />
    )
  } else if (screen === 'moved') {
    const p = forecast(ride, t, live.newAppointment).pOnTime
    const said = call.result?.response
    bar = false
    body = (
      <OutcomeScreen
        outcome={{
          pill: 'Rescheduled',
          headlineLead: `${clinicName} moved you to ${clock(live.newAppointment)}.`,
          headlineGray: 'Stay on the van; I’ll keep watching the ride.',
          was: live.appointmentLabel,
          now: clock(live.newAppointment),
          detail: said ? `They said: “${said}”` : `Confirmed by the front desk at ${hm(t)}.`,
          oddsLabel: `Chance of arriving by ${live.newAppointmentLabel}`,
          oddsValue: pct(p),
          oddsColor: oddsColor(p),
          showLocation: true,
          locationName: clinicName,
          locationAddress: town,
          transcript: lines,
          showTranscript: false,
          onToggleTranscript: noop,
          firstLabel: 'Back to my ride',
          onFirst: noop,
        }}
      />
    )
  }

  const tapping = screen === 'ask' && since > 2.6
  const tapped = screen === 'ask' && since > 3.2
  return (
    <div
      className={`live-phone ${screen === 'off' ? 'is-off' : ''} ${tapping ? 'is-tapping' : ''} ${tapped ? 'is-tapped' : ''}`}
      style={{ '--phone-scale': scale }}
      aria-label="Maria's phone"
    >
      <PhoneShell bottomBar={bar ? <AskLeewayBar mode="button" onOpenChat={noop} /> : null}>
        {/* The trip screens share one map, so moving between them doesn't reload it. */}
        <div key={['arriving', 'ride', 'arrived'].includes(screen) ? 'trip' : screen} className="live-phone-screen">
          {body}
        </div>
      </PhoneShell>
    </div>
  )
}
