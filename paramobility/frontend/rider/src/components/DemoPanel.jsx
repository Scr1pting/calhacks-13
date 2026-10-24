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
        {!demo.callsEnabled && (
          <p className="lw-demo-panel-desc lw-demo-panel-warn">
            Calls to the clinic are off. Set VITE_DEMO_CLINIC_PHONE to a phone
            you can answer to hear the agent call.
          </p>
        )}
      </div>

      <div className="lw-demo-panel-section">
        <div className="lw-demo-panel-heading">SIMULATE THE RIDE</div>
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
