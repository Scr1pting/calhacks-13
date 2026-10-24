import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import BigNumber from '../components/BigNumber.jsx'
import Divider from '../components/Divider.jsx'
import KeyValueRow from '../components/KeyValueRow.jsx'
import LocationCard from '../components/LocationCard.jsx'
import Button from '../components/Button.jsx'
import './HomeScreen.css'

// Screens 3 ("Ride booked, future day") and 3b ("Day of ride") — the same
// layout, with copy that changes on `home.today`.
export default function HomeScreen({ home }) {
  return (
    <>
      <Headline lead={home.headlineLead}>{home.headlineGray}</Headline>

      <Card>
        <div className="lw-forecast-main">
          <EyebrowLabel>{home.oddsEyebrow}</EyebrowLabel>
          <BigNumber size="xl" color="var(--lw-success)">
            {home.oddsValue}
          </BigNumber>
          <p className="lw-forecast-note">
            Based on similar trips over the last 3 months.
          </p>
        </div>
        <Divider />
        <KeyValueRow label="Pickup window" value={home.pickupWindow} />
      </Card>

      <LocationCard name={home.locationName} address={home.locationAddress} />

      <p className="lw-monitor-text">{home.monitorText}</p>

      {home.hasSecondary && home.secondary && (
        <div className="lw-secondary-row">
          <div className="lw-secondary-info">
            <span className="lw-secondary-title">
              {home.secondary.visitReason} {'·'} {home.secondary.date}
            </span>
            <span className="lw-secondary-sub">Needs a ride</span>
          </div>
          <Button variant="compact-solid" onClick={home.onPlanSecondary}>
            Plan
          </Button>
        </div>
      )}
    </>
  )
}
