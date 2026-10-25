import { useEffect, useRef } from 'react'
import { clock } from '../sim/fleet.js'
import { density, forecast } from './forecast.js'
import { filmLength, sceneAt } from './script.js'
import { StoryEnd } from './StoryOverlay.jsx'
import RealPhone from './RealPhone.jsx'

// The live story's words and Maria's phone. The map fills the left; the
// phone sits on the right, showing what Leeway shows Maria, including the
// real call to the clinic as it happens. The forecast chart under the map
// is redrawn every frame from the story's clock (getT), so it glides.
export default function LiveOverlay({ scenes, view, getT, onExit, onReplay }) {
  const { elapsed } = view.film
  const { scene, start } = sceneAt(scenes, elapsed)
  const live = scenes.live
  const since = elapsed - start
  const progress = Math.min(1, elapsed / filmLength(scenes))
  const moved = scenes.indexOf(scene) >= scenes.findIndex((s) => s.id === 'moved')

  return (
    <div className="film story live">
      <button type="button" className="film-exit" onClick={onExit}>
        Exit · Esc
      </button>

      {scene.end ? (
        <StoryEnd city onReplay={onReplay} onExit={onExit} />
      ) : (
        <section
          key={scene.id}
          className={`live-caption ${scene.center ? 'is-center' : ''} ${screenOff(scene) ? 'is-wide' : ''}`}
          aria-live="polite"
        >
          {scene.eyebrow && <div className="film-eyebrow">{scene.eyebrow}</div>}
          <h2 className="story-title">{scene.title}</h2>
          {scene.line && <p className="story-line">{scene.line}</p>}
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

      {scene.chart && <ForecastChart live={live} getT={getT} by={moved ? live.newAppointment : live.appointment} moved={moved} />}
      <RealPhone live={live} scene={scene} since={since} t={view.t} moved={moved} />

      {view.film.stepped && (
        <div className="film-keys" aria-hidden="true">
          ← → · {scenes.indexOf(scene) + 1} / {scenes.length}
        </div>
      )}
      <div className="film-progress" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}

// With the phone away, words use the whole width.
const screenOff = (scene) => (scene.phone || 'off') === 'off'

// ---- the forecast chart: when Maria arrives, as a curve over the morning ----

const W = 560
const H = 120
const PAD = 16

function ForecastChart({ live, getT, by, moved }) {
  const area = useRef(null)
  const late = useRef(null)
  const line = useRef(null)
  const odds = useRef(null)
  const eta = useRef(null)
  const from = live.appointment - 55
  const to = live.newAppointment + 20
  const x = (m) => PAD + ((m - from) / (to - from)) * (W - 2 * PAD)

  useEffect(() => {
    let raf
    const draw = () => {
      const t = getT()
      const f = forecast(live.ride, t, by)
      if (!f.sigma) {
        // Arrived: no spread left, just the moment she got there.
        const ax = x(live.ride.dropoff.t)
        area.current?.setAttribute('points', `${ax - 4},${H - 22} ${ax},14 ${ax + 4},${H - 22}`)
        late.current?.setAttribute('points', '')
        line.current?.setAttribute('points', `${ax - 4},${H - 22} ${ax},14 ${ax + 4},${H - 22}`)
        if (odds.current) {
          odds.current.textContent = f.pOnTime >= 0.5 ? 'On time' : 'Late'
          odds.current.dataset.state = f.pOnTime >= 0.5 ? 'ok' : 'late'
        }
        if (eta.current) eta.current.textContent = `arrived ${clock(live.ride.dropoff.t).replace(/ [AP]M$/, '')}`
        raf = requestAnimationFrame(draw)
        return
      }
      const xs = []
      for (let i = 0; i <= 140; i += 1) xs.push(from + ((to - from) * i) / 140)
      const peak = Math.max(...xs.map((m) => density(f, m)), 0.04)
      const y = (m) => H - 22 - (density(f, m) / peak) * (H - 40)
      const pts = xs.map((m) => `${x(m).toFixed(1)},${y(m).toFixed(1)}`)
      const base = H - 22
      const cut = xs.findIndex((m) => m > by)
      const split = cut < 0 ? xs.length : cut
      const before = pts.slice(0, split + 1)
      const after = pts.slice(Math.max(0, split - 1))
      area.current?.setAttribute('points', `${x(from)},${base} ${before.join(' ')} ${x(xs[Math.min(split, xs.length - 1)])},${base}`)
      late.current?.setAttribute('points', `${x(xs[Math.max(0, split - 1)])},${base} ${after.join(' ')} ${x(to)},${base}`)
      line.current?.setAttribute('points', pts.join(' '))
      if (odds.current) {
        odds.current.textContent = `${Math.round(f.pOnTime * 100)}%`
        odds.current.dataset.state = f.pOnTime >= 0.5 ? 'ok' : 'late'
      }
      if (eta.current) {
        eta.current.textContent = `likely ${clock(f.low).replace(/ [AP]M$/, '')}–${clock(f.high).replace(/ [AP]M$/, '')}`
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [live, getT, by, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = []
  for (let m = Math.ceil(from / 15) * 15; m <= to; m += 15) ticks.push(m)
  return (
    <div className="live-chart" aria-hidden="true">
      <div className="live-odds">
        <span ref={odds} className="live-odds-value" />
        <span className="live-odds-label">
          on time for {clock(by).replace(/ [AP]M$/, '')}
          <br />
          <span ref={eta} />
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polygon ref={area} className="live-chart-ok" />
        <polygon ref={late} className="live-chart-late" />
        <polyline ref={line} className="live-chart-line" />
        <line x1={PAD} x2={W - PAD} y1={H - 22} y2={H - 22} className="live-chart-axis" />
        {moved && <line x1={x(live.appointment)} x2={x(live.appointment)} y1={14} y2={H - 22} className="live-chart-old" />}
        <line x1={x(by)} x2={x(by)} y1={10} y2={H - 22} className="live-chart-appt" />
        <text
          x={x(by) > W - 160 ? x(by) - 6 : x(by) + 6}
          y={20}
          textAnchor={x(by) > W - 160 ? 'end' : 'start'}
          className="live-chart-appt-label"
        >
          {moved ? 'new appointment' : 'appointment'} {clock(by).replace(/ [AP]M$/, '')}
        </text>
        {ticks.map((m) => (
          <text key={m} x={x(m)} y={H - 6} className="live-chart-tick" textAnchor="middle">
            {clock(m).replace(/ [AP]M$/, '')}
          </text>
        ))}
      </svg>
    </div>
  )
}
