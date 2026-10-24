import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import StatusPill from '../components/StatusPill.jsx'
import Divider from '../components/Divider.jsx'
import Button from '../components/Button.jsx'
import './CallingClinicScreen.css'

// Screens 4 / 4b: "Calling the clinic". `call.onToggleListen` is optional:
// listening in needs live call audio the backend doesn't expose yet.
export default function CallingClinicScreen({ call }) {
  return (
    <>
      <Headline lead={call.headlineLead}>{call.headlineGray}</Headline>

      <Card>
        <div className="lw-call-status-row">
          <StatusPill tone="purple">{call.statusLabel}</StatusPill>
          <span className="lw-call-time">{call.callTime}</span>
        </div>

        <div className="lw-call-transcript" aria-live="polite">
          {call.lines.map((line, i) => (
            <div key={i} className="lw-call-line">
              <div
                className="lw-call-who"
                style={{
                  color:
                    line.tone === 'accent'
                      ? 'var(--lw-accent)'
                      : 'var(--lw-text-secondary)',
                }}
              >
                {line.who}
              </div>
              <div className="lw-call-text">{line.t}</div>
            </div>
          ))}
        </div>

        <Divider />
        <p className="lw-call-waiting">{call.waitingFor}</p>

        {call.onToggleListen && (
          <Button
            variant="secondary"
            background={call.listening ? 'var(--lw-accent-bg)' : undefined}
            onClick={call.onToggleListen}
          >
            {call.listenLabel}
          </Button>
        )}
      </Card>
    </>
  )
}
