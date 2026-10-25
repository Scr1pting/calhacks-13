import Card from './Card.jsx'
import './CallTranscript.css'

// A phone call's transcript, shown after the call ends (behind a "Hear the
// call" toggle) — used on the outcome screen and the EBP booking screen.
export default function CallTranscript({ lines }) {
  return (
    <Card>
      <div className="lw-transcript" aria-label="Call transcript">
        {lines.map((line, i) => (
          <div key={i}>
            <div
              className="lw-transcript-who"
              style={{ color: line.who === 'LEEWAY' ? 'var(--lw-accent)' : 'var(--lw-text-secondary)' }}
            >
              {line.who}
            </div>
            <div>{line.t}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
