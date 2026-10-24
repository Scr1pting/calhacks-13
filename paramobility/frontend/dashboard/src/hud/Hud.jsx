import { BANDS, bandColor, causesOf, clock, clock24, nextStops, stopsBetween, totalsAt, vanState } from '../sim/fleet.js'

const SPEEDS = [
  ['1×', 1],
  ['10×', 10],
  ['60×', 60],
  ['300×', 300],
]
const rgb = (c) => `rgb(${c.join(',')})`

export default function Hud({ fleet, view, controls, maria }) {
  const { t } = view
  const states = fleet.vans.map((v) => vanState(v, t)).filter(Boolean)
  const totals = totalsAt(fleet, t)
  const behind = states.length ? states.reduce((a, s) => a + s.behind, 0) / states.length : 0
  const selected = view.selected != null ? fleet.vansById[view.selected] : null

  return (
    <>
      <header className="panel top">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">PARAMOBILITY</div>
            <div className="brand-sub">East Bay Paratransit · simulated fleet</div>
          </div>
        </div>
        <div className="clock">
          <div className="clock-time">{clock(t)}</div>
          <div className="clock-day">{fleet.meta.weekday} · simulated day {fleet.meta.day}</div>
        </div>
      </header>

      <aside className="column left">
        <section className="panel stats">
          <Stat label="Vans on the road" value={states.length} sub={`${states.filter((s) => s.moving).length} moving`} />
          <Stat label="Pickups so far" value={totals.done.toLocaleString()} sub={`${totals.noShow} no-shows`} />
          <Stat
            label="On time"
            value={totals.done ? `${Math.round((100 * totals.onTime) / totals.done)}%` : '–'}
            sub="within the 30-min window"
            accent={rgb(BANDS[0].color)}
          />
          <Stat label="Late pickups" value={totals.late} sub="past the window" accent={rgb(BANDS[2].color)} />
          <Stat label="Avg. behind plan" value={`${behind.toFixed(1)} min`} sub="across vans on the road" />
        </section>
        {maria && <MariaCard maria={maria} t={t} controls={controls} following={view.follow && view.selected === maria.van_id} />}
      </aside>

      <aside className="column right">
        {selected && <VanCard fleet={fleet} van={selected} t={t} view={view} controls={controls} />}
        <LateFeed fleet={fleet} t={t} controls={controls} />
        <Legend />
      </aside>

      <Timeline fleet={fleet} view={view} controls={controls} />
    </>
  )
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true">
      <path
        d="M3 18 C8 9 12 9 15 15 C18 21 22 21 27 12"
        fill="none"
        stroke="var(--teal)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}

function MariaCard({ maria, t, controls, following }) {
  const { pickup, dropoff } = maria
  let status
  if (t < maria.windowStart - 30) status = `Pickup window ${pickup.window.join('–')}`
  else if (t < pickup.t) status = `Waiting for van ${maria.van_id}`
  else if (!dropoff || t < dropoff.t) status = 'On board'
  else status = `Arrived ${clock(dropoff.t)}`
  const late = t >= pickup.t && pickup.late > 0
  return (
    <section className="panel card maria">
      <div className="label">Demo rider</div>
      <div className="card-title">
        <span className="dot" style={{ background: 'var(--pink)' }} /> Maria · {maria.purpose}
      </div>
      <div className="card-line">{maria.pickup.place} → {maria.dropoff?.place ?? maria.dropoff}</div>
      <div className="card-line">
        Window {pickup.window.join('–')} · appointment {maria.appointment}
      </div>
      <div className="card-status">{status}</div>
      {late && (
        <div className="card-line warn">
          Picked up {pickup.late.toFixed(0)} min past her window
        </div>
      )}
      <button type="button" className="btn" onClick={following ? controls.unfollow : () => controls.followMaria()}>
        {following ? 'Stop following' : 'Follow Maria’s ride'}
      </button>
    </section>
  )
}

function VanCard({ fleet, van, t, view, controls }) {
  const state = vanState(van, t)
  const upcoming = nextStops(fleet, van.id, t, 3)
  return (
    <section className="panel card">
      <div className="card-head">
        <div>
          <div className="label">Selected van</div>
          <div className="card-title">Van {van.id}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={controls.clearSelection}>
          ×
        </button>
      </div>
      {state ? (
        <>
          <div className="card-status" style={{ color: rgb(bandColor(state.behind)) }}>
            {state.moving ? 'Driving' : 'At a stop'} ·{' '}
            {state.behind > 0.5 ? `${state.behind.toFixed(0)} min behind plan` : 'on plan'}
          </div>
          {upcoming.length > 0 && <div className="label spaced">Next stops</div>}
          <ul className="stops">
            {upcoming.map((s) => (
              <li key={`${s.trip}${s.kind}`}>
                <span className={`kind kind-${s.kind}`}>{s.kind === 'P' ? 'Pickup' : 'Drop-off'}</span>
                <span className="stop-place">{s.place}</span>
                <span className="stop-time">{clock24(s.t)}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={view.follow ? controls.unfollow : controls.follow}>
            {view.follow ? 'Stop following' : 'Follow this van'}
          </button>
        </>
      ) : (
        <div className="card-line">Not on the road right now.</div>
      )}
    </section>
  )
}

function LateFeed({ fleet, t, controls }) {
  const late = stopsBetween(fleet, fleet.meta.start, t)
    .filter((s) => s.kind === 'P' && s.status !== 'no_show' && !s.onTime)
    .slice(-6)
    .reverse()
  return (
    <section className="panel feed">
      <div className="label">Late pickups</div>
      {late.length === 0 && <div className="card-line">None yet today.</div>}
      <ul>
        {late.map((s) => {
          const causes = causesOf(s).slice(0, 2)
          return (
            <li key={s.trip}>
              <button type="button" className="feed-item" onClick={() => controls.select(s.van)}>
                <div className="feed-top">
                  <span className="feed-late">+{s.late.toFixed(0)} min</span>
                  <span className="feed-time">{clock24(s.t)} · van {s.van}</span>
                </div>
                <div className="feed-place">{s.place}</div>
                <div className="chips">
                  {causes.map((c) => (
                    <span key={c.key} className="chip">
                      {c.label} {c.minutes.toFixed(0)}m
                    </span>
                  ))}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Legend() {
  return (
    <section className="panel legend">
      {BANDS.map((b) => (
        <div key={b.label} className="legend-row">
          <span className="dot" style={{ background: rgb(b.color) }} /> {b.label}
        </div>
      ))}
      <div className="legend-row">
        <span className="line" /> Selected van’s route ahead
      </div>
    </section>
  )
}

function Timeline({ fleet, view, controls }) {
  const { start, end } = fleet.meta
  const bins = []
  let max = 1
  for (let b = Math.floor(start / 15); b <= Math.floor(end / 15); b += 1) {
    const n = fleet.lateBins[b] || 0
    max = Math.max(max, n)
    bins.push({ b, n })
  }
  const span = end - start
  const ticks = []
  for (let h = Math.ceil(start / 120) * 2; h * 60 <= end; h += 2) ticks.push(h * 60)
  const pct = ((view.t - start) / span) * 100
  return (
    <footer className="panel timeline">
      <button
        type="button"
        className="play"
        aria-label={view.playing ? 'Pause' : 'Play'}
        onClick={controls.togglePlay}
      >
        {view.playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
            <rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 1.5 L12.5 7 L3 12.5 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="track">
        <div className="bins" aria-hidden="true">
          {bins.map(({ b, n }) => (
            <span
              key={b}
              style={{
                left: `${((b * 15 - start) / span) * 100}%`,
                height: `${(n / max) * 100}%`,
                opacity: b * 15 <= view.t ? 0.95 : 0.35,
              }}
            />
          ))}
        </div>
        <input
          type="range"
          aria-label="Time of day"
          min={start}
          max={end}
          step={1}
          value={view.t}
          onChange={(e) => controls.setTime(Number(e.target.value))}
          style={{ '--pct': `${pct}%` }}
        />
        <div className="ticks" aria-hidden="true">
          {ticks.map((tk) => (
            <span key={tk} style={{ left: `${((tk - start) / span) * 100}%` }}>
              {clock(tk).replace(':00', '')}
            </span>
          ))}
        </div>
      </div>
      <div className="speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map(([label, s]) => (
          <button
            key={s}
            type="button"
            className={view.speed === s ? 'active' : ''}
            onClick={() => controls.setSpeed(s)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="timeline-note">Late pickups per 15 min</div>
    </footer>
  )
}
