import { useEffect, useRef } from 'react'
import { clock } from '../sim/fleet.js'
import { filmLength, sceneAt } from './script.js'
import { sampleAt } from './presentation.js'
import { isPaired, presentationSync } from './presentationSync.js'
import { StoryEnd } from './StoryOverlay.jsx'
import PresentationPhone from './PresentationPhone.jsx'

const hm = (t) => clock(t).replace(/ [AP]M$/, '')

// The presentation's words and the rider's phone, laid out like the live
// story (LiveOverlay.jsx). Its chart is the server's chance of arriving on
// time over the morning, drawn up to now every frame from the film's clock
// (getT), with the 50% line where Leeway asks.
export default function PresentationOverlay({ scenes, view, getT, onExit, onReplay }) {
  const { elapsed } = view.film
  const { scene, start } = sceneAt(scenes, elapsed)
  const { pres } = scenes
  const progress = Math.min(1, elapsed / filmLength(scenes))
  // A paired real phone plays her phone: no phone on screen, the words use the width.
  const paired = isPaired()
  // The clinic moved the appointment on the call: the words and the chart follow.
  const movedTo = presentationSync.movedTo(pres.appointment)
  const words = (text) => text.replace('{time}', hm(movedTo))
  const late = movedTo != null && pres.arrival > movedTo
  const title = movedTo != null && scene.ifMoved?.title ? words(scene.ifMoved.title) : scene.title
  const line =
    movedTo != null && scene.ifMoved
      ? words((late && scene.ifMoved.lineIfLate) || scene.ifMoved.line || scene.line)
      : scene.line

  return (
    <div className={`film story live ${paired ? 'no-phone' : ''}`}>
      <button type="button" className="film-exit" onClick={onExit}>
        Exit · Esc
      </button>

      {scene.end ? (
        <StoryEnd city onReplay={onReplay} onExit={onExit} />
      ) : (
        <section
          key={scene.id}
          className={`live-caption ${scene.center ? 'is-center' : ''} ${paired || (scene.phone || 'off') === 'off' ? 'is-wide' : ''}`}
          aria-live="polite"
        >
          {scene.eyebrow && <div className="film-eyebrow">{scene.eyebrow}</div>}
          <h2 className="story-title">{title}</h2>
          {line && <p className="story-line">{line}</p>}
          {scene.points && (
            <ol className="live-points">
              {scene.points.map((p, i) => (
                <li key={p} style={{ animationDelay: `${0.35 + i * 0.45}s` }}>
                  {p}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {scene.chart && <ChanceChart pres={pres} getT={getT} />}
      {/* The app starts once the film's first frame has set its clock. */}
      {!paired && <PresentationPhone pres={pres} scene={scene} since={elapsed - start} t={view.t} ready={view.film.index >= 0} />}

      {view.film.stepped && (
        <div className="film-keys" aria-hidden="true">
          ← → · {scenes.indexOf(scene) + 1} / {scenes.length}
        </div>
      )}
      <div className="film-progress" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}

// ---- the chance of arriving on time, as the morning goes ----

const W = 560
const H = 120
const PAD = 16
const TOP = 12
const BASE = H - 22

function ChanceChart({ pres, getT }) {
  const label = useRef(null)
  // After the clinic moves the appointment: when, and the server's chance since, against the new time.
  const after = useRef({ at: null, samples: [] })
  const line = useRef(null)
  const area = useRef(null)
  const dot = useRef(null)
  const odds = useRef(null)
  const eta = useRef(null)
  const pickup = useRef(null)
  const asked = useRef(null)
  const from = pres.windowStart - 10
  const to = pres.arrivedT + 2
  const x = (m) => PAD + ((m - from) / (to - from)) * (W - 2 * PAD)
  const y = (p) => BASE - p * (BASE - TOP)

  useEffect(() => {
    let raf
    const points = pres.timeline.filter((q) => q.t >= from && q.t <= to)
    const draw = () => {
      const t = Math.min(to, Math.max(from, getT()))
      const s = { ...sampleAt(pres.timeline, t) }
      const movedTo = presentationSync.movedTo(pres.appointment)
      const a = after.current
      if (movedTo == null || (a.at != null && t < a.at)) {
        a.at = null
        a.samples = []
      }
      if (movedTo != null) {
        const p = presentationSync.get().trip?.outlook?.p_on_time
        if (a.at == null) a.at = t
        if (p != null) {
          s.p_on_time = p
          const last = a.samples[a.samples.length - 1]
          if (!last || t - last[0] >= 0.25) a.samples.push([t, p])
        }
        s.minutes_late = Math.max(0, Math.round(pres.arrival - movedTo))
      }
      const until = a.at ?? t
      const pts = points.filter((q) => q.t < until).map((q) => `${x(q.t).toFixed(1)},${y(q.p_on_time).toFixed(1)}`)
      for (const [st, sp] of a.samples) pts.push(`${x(st).toFixed(1)},${y(sp).toFixed(1)}`)
      pts.push(`${x(t).toFixed(1)},${y(s.p_on_time).toFixed(1)}`)
      if (label.current) label.current.textContent = `on time for ${hm(movedTo ?? pres.appointment)}`
      line.current?.setAttribute('points', pts.join(' '))
      area.current?.setAttribute('points', `${x(from)},${BASE} ${pts.join(' ')} ${x(t).toFixed(1)},${BASE}`)
      dot.current?.setAttribute('cx', x(t).toFixed(1))
      dot.current?.setAttribute('cy', y(s.p_on_time).toFixed(1))
      const late = s.p_on_time < 0.5
      if (dot.current) dot.current.dataset.state = late ? 'late' : 'ok'
      if (odds.current) {
        // Once she's there it's no longer a chance: how it went.
        const arrived = s.phase === 'arrived'
        odds.current.textContent = arrived
          ? s.minutes_late > 0
            ? `${s.minutes_late} min late`
            : 'On time'
          : `${Math.round(s.p_on_time * 100)}%`
        odds.current.dataset.state = late ? 'late' : 'ok'
        odds.current.dataset.arrived = arrived ? 'yes' : ''
      }
      if (eta.current) {
        eta.current.textContent = s.phase === 'arrived' ? `arrived ${hm(pres.arrival)}` : `likely ${hm(s.eta_low)}–${hm(s.eta_high)}`
      }
      pickup.current?.setAttribute('opacity', t >= pres.ride.pickup.t ? 1 : 0)
      asked.current?.setAttribute('opacity', pres.ask && t >= pres.ask.t ? 1 : 0)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [pres, getT]) // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = []
  for (let m = Math.ceil(from / 15) * 15; m <= to; m += 15) ticks.push(m)
  const askP = pres.ask?.p_on_time ?? 0.5
  return (
    <div className="live-chart" aria-hidden="true">
      <div className="live-odds">
        <span ref={odds} className="live-odds-value" />
        <span className="live-odds-label">
          <span ref={label}>on time for {pres.appointmentLabel}</span>
          <br />
          <span ref={eta} />
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <rect x={x(pres.windowStart)} y={TOP} width={x(pres.windowEnd) - x(pres.windowStart)} height={BASE - TOP} className="pres-chart-window" />
        <text x={x(pres.windowStart) + 5} y={BASE - 6} className="live-chart-tick">
          pickup window
        </text>
        <polygon ref={area} className="pres-chart-area" />
        <line x1={PAD} x2={W - PAD} y1={y(0.5)} y2={y(0.5)} className="pres-chart-half" />
        <text x={PAD + 4} y={y(0.5) - 5} className="live-chart-tick">
          50% · Leeway asks
        </text>
        <polyline ref={line} className="live-chart-line" />
        <line x1={PAD} x2={W - PAD} y1={BASE} y2={BASE} className="live-chart-axis" />
        <g ref={pickup} opacity="0">
          <line x1={x(pres.ride.pickup.t)} x2={x(pres.ride.pickup.t)} y1={TOP} y2={BASE} className="pres-chart-mark" />
          <text x={x(pres.ride.pickup.t) + 5} y={TOP + 9} className="live-chart-tick">
            picked up
          </text>
        </g>
        {pres.ask && (
          <g ref={asked} opacity="0">
            <circle cx={x(pres.ask.t)} cy={y(askP)} r="5" className="pres-chart-ask" />
            <text x={x(pres.ask.t) + 8} y={y(askP) + 16} className="live-chart-appt-label">
              asks {hm(pres.ask.t)}
            </text>
          </g>
        )}
        <circle ref={dot} r="3.5" className="pres-chart-dot" />
        {ticks.map((m) => (
          <text key={m} x={x(m)} y={H - 6} className="live-chart-tick" textAnchor="middle">
            {hm(m)}
          </text>
        ))}
      </svg>
    </div>
  )
}
