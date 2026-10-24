import './DemoPanel.css'

// The review/jump panel from the design prototype's own side panel — lets
// you click through every screen or simulate an event instead of waiting
// for the real flow. Development/review tool, not part of the rider-facing
// product.
export default function DemoPanel({ stepGroups, simulate }) {
  return (
    <div className="lw-demo-panel">
      <div className="lw-demo-panel-intro">
        <div className="lw-demo-panel-title">Denise's journey</div>
        <p className="lw-demo-panel-desc">
          The phone is live. Tap through it, or jump to any step. All times,
          percentages and availability are sample data.
        </p>
      </div>

      <div className="lw-demo-panel-section">
        <div className="lw-demo-panel-heading">Simulate</div>
        {simulate.map((sm) => (
          <button
            key={sm.label}
            type="button"
            className="lw-demo-sim-button"
            onClick={sm.onClick}
          >
            {sm.label}
          </button>
        ))}
      </div>

      {stepGroups.map((group) => (
        <div key={group.title} className="lw-demo-panel-section">
          <div className="lw-demo-panel-heading">{group.title}</div>
          {group.steps.map((step) => (
            <button
              key={step.key}
              type="button"
              className={`lw-demo-step-button${step.active ? ' lw-demo-step-button-active' : ''}`}
              onClick={step.onClick}
            >
              <span className="lw-demo-step-num">{step.num}</span>
              {step.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
