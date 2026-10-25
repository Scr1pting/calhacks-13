import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import BigNumber from '../components/BigNumber.jsx'
import Divider from '../components/Divider.jsx'
import KeyValueRow from '../components/KeyValueRow.jsx'
import LocationCard from '../components/LocationCard.jsx'
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
          <BigNumber size="xl" color={home.oddsColor}>
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
    </>
  )
}
