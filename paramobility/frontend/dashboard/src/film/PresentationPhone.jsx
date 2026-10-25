import { useEffect, useRef } from 'react'
import { usePhoneScale } from './RealPhone.jsx'
import { filmRider } from './riderApi.js'
// The rider app itself: its flow (which screen, and every word on it) and its phone.
import '../../../rider/src/tokens.css'
import { LeewayPhone } from '../../../rider/src/App.jsx'
import { useLeewayFlow } from '../../../rider/src/state/useLeewayFlow.js'

// The rider's phone in the presentation: the real rider app, running its own
// logic against a stand-in for the server that has the presentation trip as
// the film's clock says (riderApi.js). The app decides what it shows; the film
// only presses its buttons, the way the rider would (`scene.tap`: the primary
// button, or the button with that text, `at` seconds into the shot).

function RiderApp() {
  const flow = useLeewayFlow()
  return <LeewayPhone flow={flow} />
}

const TAP_LEAD = 0.6 // the press shows this long before the tap lands
// Sim minutes the clock can move between two updates in normal play; more is a seek.
const SEEK_MIN = 5

export default function PresentationPhone({ pres, scene, since, t, ready }) {
  const scale = usePhoneScale()
  const box = useRef(null)
  // A fresh app for a fresh ride: when the film starts, or jumps (a seek, either
  // way). The app only knows what it was told as it happened.
  const run = useRef({ key: 0, t: null })
  if (ready && (run.current.t === null || Math.abs(t - run.current.t) > SEEK_MIN)) {
    filmRider.reset(pres, t)
    run.current.key += 1
  }
  if (ready) run.current.t = t
  useEffect(() => {
    if (ready) filmRider.tick(t)
  }, [t, ready])

  // The film's taps, once per shot.
  const tapped = useRef(new Set())
  const tap = scene.tap
  const tapKey = tap && `${run.current.key}|${scene.id}`
  useEffect(() => {
    if (!tap || since < tap.at || tapped.current.has(tapKey)) return
    tapped.current.add(tapKey)
    const buttons = [...(box.current?.querySelectorAll('button') || [])]
    const target =
      tap.button === 'primary'
        ? box.current?.querySelector('.lw-btn-primary')
        : buttons.find((b) => b.textContent.trim().includes(tap.button))
    target?.click()
  })

  const off = (scene.phone || 'off') === 'off'
  const pressing = tap?.button === 'primary' && since >= tap.at - TAP_LEAD
  return (
    <div
      ref={box}
      className={`live-phone ${off ? 'is-off' : ''} ${pressing ? 'is-tapping' : ''} ${pressing && since >= tap.at ? 'is-tapped' : ''}`}
      style={{ '--phone-scale': scale }}
      aria-label={`${pres.name}'s phone`}
    >
      {ready && <RiderApp key={run.current.key} />}
    </div>
  )
}
