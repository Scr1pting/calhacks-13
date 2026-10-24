import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import StatusPill from '../components/StatusPill.jsx'
import Divider from '../components/Divider.jsx'
import LocationCard from '../components/LocationCard.jsx'
import Button from '../components/Button.jsx'
import './OutcomeScreen.css'

const CalendarIcon = (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
    <rect x="2" y="3" width="14" height="13" rx="2" fill="none" stroke="#141618" strokeWidth="2" />
    <path d="M6 1 V5 M12 1 V5 M2 7 H16" stroke="#141618" strokeWidth="2" />
  </svg>
)

const PhoneIcon = (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
    <path
      d="M3 2 H6.5 L8 6 L6 7.5 A9 9 0 0 0 10.5 12 L12 10 L16 11.5 V15 A1.5 1.5 0 0 1 14.5 16.5 A13 13 0 0 1 1.5 3.5 A1.5 1.5 0 0 1 3 2Z"
      fill="none"
      stroke="#141618"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
)

// Screens 5 / 6c: "Outcome" of a call to the appointment: rescheduled, still
// on, or unclear (`outcome.pill`). "Hear the call" shows the call transcript.
export default function OutcomeScreen({ outcome }) {
  return (
    <>
      <Headline lead={outcome.headlineLead}>{outcome.headlineGray}</Headline>

      <Card>
        <StatusPill tone="green">{outcome.pill || 'Rescheduled'}</StatusPill>
        <div className="lw-outcome-times">
          {outcome.was && <span className="lw-outcome-was">{outcome.was}</span>}
          <span className="lw-outcome-now">{outcome.now}</span>
        </div>
        <p className="lw-outcome-detail">{outcome.detail}</p>
        <Divider />
        <div className="lw-outcome-odds">
          <span className="lw-outcome-odds-label">{outcome.oddsLabel}</span>
          <span className="lw-outcome-odds-value" style={{ color: outcome.oddsColor }}>
            {outcome.oddsValue}
          </span>
        </div>
      </Card>

      {outcome.showLocation && (
        <LocationCard name={outcome.locationName} address={outcome.locationAddress} />
      )}

      <div className="lw-outcome-actions">
        <Button variant="compact-outline" icon={CalendarIcon} onClick={outcome.onFirst}>
          {outcome.firstLabel}
        </Button>
        {outcome.transcript?.length > 0 && (
          <Button variant="compact-outline" icon={PhoneIcon} onClick={outcome.onToggleTranscript}>
            {outcome.showTranscript ? 'Hide the call' : 'Hear the call'}
          </Button>
        )}
      </div>

      {outcome.showTranscript && (
        <Card>
          <div className="lw-outcome-transcript" aria-label="Call transcript">
            {outcome.transcript.map((line, i) => (
              <div key={i}>
                <div
                  className="lw-outcome-transcript-who"
                  style={{ color: line.who === 'LEEWAY' ? 'var(--lw-accent)' : 'var(--lw-text-secondary)' }}
                >
                  {line.who}
                </div>
                <div>{line.t}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
