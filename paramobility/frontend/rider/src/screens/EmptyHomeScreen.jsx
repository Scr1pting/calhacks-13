import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import KeyValueRow from '../components/KeyValueRow.jsx'
import Button from '../components/Button.jsx'

// Screen 3a: "Nothing to plan".
export default function EmptyHomeScreen({ empty }) {
  return (
    <>
      <Headline lead="Nothing to plan right now.">
        No appointments in your calendar need a ride in the next two weeks.
        I'll let you know when one does.
      </Headline>

      {empty.lastTrip && (
      <Card>
        <EyebrowLabel>Last trip</EyebrowLabel>
        <div className="lw-kv-row">
          <span style={{ fontSize: 17, fontWeight: 500 }}>{empty.lastTrip.title}</span>
          <span className="lw-kv-label">{empty.lastTrip.date}</span>
        </div>
        <KeyValueRow
          label="Arrived"
          value={
            <span style={{ color: 'var(--lw-success)' }}>
              {empty.lastTrip.arrivedText}
            </span>
          }
        />
      </Card>
      )}

      <Button variant="secondary" onClick={empty.onRestart}>
        Book a ride yourself
      </Button>
    </>
  )
}
