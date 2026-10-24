import { useState } from 'react'
import { BANDS, bandColor, causesOf, clock, clock24, nextStops, stopsBetween, totalsAt, vanState } from '../sim/fleet.js'

// The dashboard's overlay, in the Leeway look (the rider app's tokens and
// components): one summary card, two actions, and cards that appear only when
// they're needed. Everything else is the map.

const SPEEDS = [
  ['1×', 1],
  ['10×', 10],
  ['60×', 60],
  ['300×', 300],
]
const rgb = (c) => `rgb(${c.join(',')})`

export default function Hud({ fleet, view, controls, maria }) {
  const [showLate, setShowLate] = useState(false)
  const { t } = view
  const states = fleet.vans.map((v) => vanState(v, t)).filter(Boolean)
  const totals = totalsAt(fleet, t)
  const behind = states.length ? states.reduce((a, s) => a + s.behind, 0) / states.length : 0
  const followingMaria = maria && view.follow && view.selected === maria.van_id
  const selected = view.selected != null && !followingMaria ? fleet.vansById[view.selected] : null
  const onTime = totals.done ? Math.round((100 * totals.onTime) / totals.done) : null

  return (
    <>
      <div className="brand">
        <Logo />
        <span className="brand-name">Leeway</span>
        <span className="brand-sub">Fleet</span>
      </div>

      <section className="card summary">
        <div className="eyebrow">
          {fleet.meta.weekday} · {clock(t)} · simulated
        </div>
        <p className="headline">
          {states.length} vans on the road.{' '}
          <span className="gray">
            {onTime == null
              ? 'No pickups yet today.'
              : `${onTime}% of pickups on time so far. ${totals.late} were late.`}
          </span>
        </p>
        <div className="divider" />
        <div className="kv">
          <span>Average behind plan</span>
          <span className="kv-value" style={{ color: rgb(bandColor(behind)) }}>
            {behind.toFixed(1)} min
          </span>
        </div>
      </section>

      <div className="side">
        <div className="actions">
          {followingMaria ? (
            <button type="button" className="btn btn-pill" onClick={controls.unfollow}>
              Following Maria · Stop
            </button>
          ) : (
            <button type="button" className="btn btn-solid" onClick={() => controls.followMaria()}>
              Follow Maria’s ride
            </button>
          )}
          <button
            type="button"
            className={`btn btn-outline ${showLate ? 'pressed' : ''}`}
            aria-pressed={showLate}
            onClick={() => setShowLate(!showLate)}
          >
            Late pickups · {totals.late}
          </button>
        </div>
        {followingMaria && <MariaCard maria={maria} t={t} />}
        {selected && <VanCard fleet={fleet} van={selected} t={t} view={view} controls={controls} />}
        {showLate && <LateCard fleet={fleet} t={t} controls={controls} />}
      </div>

      <Timeline fleet={fleet} view={view} controls={controls} />
    </>
  )
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 30 30" aria-hidden="true">
      <path
        d="M3 18 C8 9 12 9 15 15 C18 21 22 21 27 12"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MariaCard({ maria, t }) {
  const { pickup, dropoff } = maria
  let lead
  if (t < pickup.t) lead = `Maria is waiting for van ${maria.van_id}.`
  else if (!dropoff || t < dropoff.t) lead = 'Maria is on her way.'
  else lead = `Maria arrived at ${clock(dropoff.t)}.`
  const late = t >= pickup.t && pickup.late > 0
  return (
    <section className="card">
      <div className="eyebrow">Maria · {maria.purpose}</div>
      <p className="headline small">
        {lead}{' '}
        <span className="gray">
          Pickup window {pickup.window.join('–')}, appointment at {maria.appointment}.
        </span>
      </p>
      {late && <span className="pill pill-warn">Picked up {pickup.late.toFixed(0)} min late</span>}
    </section>
  )
}

function VanCard({ fleet, van, t, view, controls }) {
  const state = vanState(van, t)
  const next = nextStops(fleet, van.id, t, 1)[0]
  const band = state && BANDS.find((b) => state.behind < b.max)
  return (
    <section className="card">
      <div className="card-head">
        <div className="eyebrow">Van {van.id}</div>
        <button type="button" className="close" aria-label="Close" onClick={controls.clearSelection}>
          ×
        </button>
      </div>
      {state ? (
        <>
          <p className="headline small">
            {state.moving ? 'Driving.' : 'At a stop.'}{' '}
            {next && (
              <span className="gray">
                Next: {next.kind === 'P' ? 'pickup' : 'drop-off'} at {next.place}, {clock(next.t)}.
              </span>
            )}
          </p>
          <span className="pill" style={{ color: rgb(band.color), background: `rgba(${band.color.join(',')}, 0.12)` }}>
            {state.behind > 0.5 ? `${state.behind.toFixed(0)} min behind plan` : 'On plan'}
          </span>
          <button type="button" className="btn btn-outline wide" onClick={view.follow ? controls.unfollow : controls.follow}>
            {view.follow ? 'Stop following' : 'Follow this van'}
          </button>
        </>
      ) : (
        <p className="gray">Not on the road right now.</p>
      )}
    </section>
  )
}

function LateCard({ fleet, t, controls }) {
  const late = stopsBetween(fleet, fleet.meta.start, t)
    .filter((s) => s.kind === 'P' && s.status !== 'no_show' && !s.onTime)
    .slice(-5)
    .reverse()
  return (
    <section className="card late">
      <div className="eyebrow">Latest late pickups</div>
      {late.length === 0 && <p className="gray">None yet today.</p>}
      <ul>
        {late.map((s) => {
          const cause = causesOf(s)[0]
          return (
            <li key={s.trip}>
              <button type="button" onClick={() => controls.select(s.van)}>
                <span className="late-min">+{s.late.toFixed(0)} min</span>
                <span className="late-place">{s.place}</span>
                <span className="late-why">
                  {clock24(s.t)} · van {s.van}
                  {cause ? ` · ${cause.label.toLowerCase()}` : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Timeline({ fleet, view, controls }) {
  const { start, end } = fleet.meta
  const pct = ((view.t - start) / (end - start)) * 100
  return (
    <footer className="timeline">
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
      <span className="time">{clock(view.t)}</span>
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
      <div className="speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map(([label, s]) => (
          <button key={s} type="button" className={view.speed === s ? 'active' : ''} onClick={() => controls.setSpeed(s)}>
            {label}
          </button>
        ))}
      </div>
    </footer>
  )
}
