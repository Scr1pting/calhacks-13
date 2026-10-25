import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import Divider from '../components/Divider.jsx'
import LiveMap from '../components/LiveMap.jsx'
import './LiveTripScreen.css'

// Screen 8: "Live trip" — shown once the van has picked the rider up.
// `ride.progress`/`heavyTraffic` position the sample GPS dot (see
// src/lib/liveRoute.js); the headline, odds, color and reason are the real
// backend outlook for this trip.
export default function LiveTripScreen({ ride }) {
  return (
    <>
      <Headline lead={ride.headlineLead}>{ride.headlineGray}</Headline>

      <LiveMap progress={ride.progress} heavyTraffic={ride.heavyTraffic} label={ride.mapLabel} />

      <Card>
        <div className="lw-ride-main">
          <EyebrowLabel>{ride.label}</EyebrowLabel>
          <div className="lw-ride-big-row">
            <span className="lw-ride-big" style={{ color: ride.color }}>
              {ride.big}
            </span>
            <span className="lw-ride-delta">{ride.delta}</span>
          </div>
          <p className="lw-ride-reason" aria-live="polite">
            {ride.reason}
          </p>
        </div>
        <Divider />
        <div className="lw-ride-row">
          <span className="lw-ride-row-label">{ride.rowLabel}</span>
          <span className="lw-ride-row-value">{ride.rowValue}</span>
        </div>
      </Card>
    </>
  )
}
