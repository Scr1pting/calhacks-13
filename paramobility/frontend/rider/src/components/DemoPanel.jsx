import { useState } from 'react'
import './DemoPanel.css'

// Side panel for running the live demo: what the backend knows about the
// current trip, its recent activity, and buttons that send real ride updates
// (as the van's tracking would). Development/demo tool, not part of the
// rider-facing product.
export default function DemoPanel({ demo }) {
  return (
    <div className="lw-demo-panel">
      <div className="lw-demo-panel-intro">
        <div className="lw-demo-panel-title">Denise's journey</div>
        <p className="lw-demo-panel-desc">
          The phone talks to the live backend at {demo.apiBase}. The calendar
          and the East Bay Paratransit booking call are mocks; planning,
          monitoring, the clinic calls and chat are real.
        </p>
      </div>

      <div className="lw-demo-panel-section">
        <div className="lw-demo-panel-heading">JUDGE DEMO</div>
        <button type="button" className="lw-demo-start-button" onClick={demo.onStartDemo}>
          Start judge demo
        </button>
      </div>

      <CallNumber calls={demo.calls} />

      <div className="lw-demo-panel-section">
        <div className="lw-demo-panel-heading">SIMULATE</div>
        {demo.simulate.map((sm) => (
          <button
            key={sm.label}
            type="button"
            className="lw-demo-sim-button"
            onClick={sm.onClick}
            disabled={sm.disabled}
          >
            {sm.label}
          </button>
        ))}
      </div>

      {demo.groups.map((g) => (
        <div className="lw-demo-panel-section" key={g.title}>
          <div className="lw-demo-panel-heading">{g.title}</div>
          {g.steps.map((st) => (
            <button
              key={st.label}
              type="button"
              className={`lw-demo-nav-button${st.active ? ' lw-demo-nav-button-active' : ''}`}
              onClick={st.onClick}
            >
              <span className="lw-demo-nav-n">{st.n}</span>
              {st.label}
            </button>
          ))}
        </div>
      ))}

      {demo.graveyard?.length > 0 && (
        <div className="lw-demo-panel-section">
          <button type="button" className="lw-demo-panel-heading lw-demo-graveyard-toggle" onClick={demo.onToggleGraveyard}>
            {demo.graveyardOpen ? 'GRAVEYARD ▲' : 'GRAVEYARD (older/internal screens) ▼'}
          </button>
          {demo.graveyardOpen &&
            demo.graveyard.map((g) => (
              <div className="lw-demo-panel-section" key={g.title}>
                <div className="lw-demo-panel-heading">{g.title}</div>
                {g.steps.map((st) => (
                  <button
                    key={st.label}
                    type="button"
                    className={`lw-demo-nav-button${st.active ? ' lw-demo-nav-button-active' : ''}`}
                    onClick={st.onClick}
                  >
                    <span className="lw-demo-nav-n">{st.n}</span>
                    {st.label}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}

      {demo.trip && (
        <div className="lw-demo-panel-section">
          <div className="lw-demo-panel-heading">CURRENT TRIP</div>
          <div className="lw-demo-trip-title">{demo.trip.title}</div>
          <dl className="lw-demo-rows">
            {demo.trip.rows.map(([label, value]) => (
              <div key={label} className="lw-demo-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {demo.activity.length > 0 && (
        <div className="lw-demo-panel-section">
          <div className="lw-demo-panel-heading">RECENT ACTIVITY</div>
          <ol className="lw-demo-activity">
            {demo.activity.map((a) => (
              <li key={a.id}>
                <span className="lw-demo-activity-time">{a.time}</span>
                {a.text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// The number Leeway calls as "the clinic". The server checks it before any
// call: a valid US number, not an agency or premium line, approved (by the
// server's allowlist or its PIN), and not called too often.
function CallNumber({ calls }) {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState({ busy: false, error: '' })

  async function submit(e) {
    e.preventDefault()
    if (!consent) return setState({ busy: false, error: 'Confirm you can answer this phone first.' })
    setState({ busy: true, error: '' })
    try {
      await calls.set(phone, pin)
      setPhone('')
      setPin('')
      setConsent(false)
      setState({ busy: false, error: '' })
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }

  return (
    <div className="lw-demo-panel-section">
      <div className="lw-demo-panel-heading">CALLS TO THE CLINIC</div>
      {calls.phone ? (
        <p className="lw-demo-panel-desc">
          Leeway calls <b>{calls.phone}</b> as the clinic, for rides planned from now on.{' '}
          <button type="button" className="lw-demo-link" onClick={calls.clear}>
            Turn calls off
          </button>
        </p>
      ) : (
        <p className="lw-demo-panel-desc lw-demo-panel-warn">
          Calls are off. Add a phone you can answer to hear the agent call.
        </p>
      )}
      <form className="lw-demo-call-form" onSubmit={submit}>
        <input
          className="lw-demo-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-label="Number to call"
          placeholder="(415) 555-0123"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <input
          className="lw-demo-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Server PIN"
          placeholder="PIN (for a new number)"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <label className="lw-demo-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I can answer this phone, and agree to a call from an AI assistant.</span>
        </label>
        <button type="submit" className="lw-demo-sim-button" disabled={state.busy || !phone.trim()}>
          {state.busy ? 'Checking…' : calls.phone ? 'Use this number instead' : 'Use this number'}
        </button>
        {state.error && (
          <p className="lw-demo-panel-desc lw-demo-panel-warn" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </div>
  )
}
