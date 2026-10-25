import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import StatusPill from '../components/StatusPill.jsx'
import Divider from '../components/Divider.jsx'
import LocationCard from '../components/LocationCard.jsx'
import Button from '../components/Button.jsx'
import CallTranscript from '../components/CallTranscript.jsx'
import { CalendarIcon, PhoneIcon } from '../components/icons.jsx'
import './OutcomeScreen.css'

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

      {outcome.showTranscript && <CallTranscript lines={outcome.transcript} />}
    </>
  )
}
