import EyebrowLabel from '../components/EyebrowLabel.jsx'
import Card from '../components/Card.jsx'
import BigNumber from '../components/BigNumber.jsx'
import Divider from '../components/Divider.jsx'
import LocationCard from '../components/LocationCard.jsx'
import Button from '../components/Button.jsx'
import NotNowButton from '../components/NotNowButton.jsx'
import './RecommendedBookingScreen.css'

// Screen 2: "Recommended booking". No bottom bar on this screen.
// While the plan is still being worked out, `recommend.ready` is false and
// only the headline shows — the rider lands here directly from "Arrange
// rides" rather than passing through a separate loading screen.
export default function RecommendedBookingScreen({ recommend }) {
  if (!recommend.ready) {
    return (
      <>
        <div className="lw-recommend-head">
          <div className="lw-recommend-headline">
            Here's what I'd book.{' '}
            <span className="lw-recommend-headline-gray">{recommend.headlineGray}</span>
          </div>
        </div>
        {recommend.failed && (
          <Button variant="primary" onClick={recommend.onRetry}>
            Try again
          </Button>
        )}
        <NotNowButton onClick={recommend.onNotNow} />
      </>
    )
  }

  return (
    <>
      <div className="lw-recommend-head">
        <EyebrowLabel>{recommend.stepLabel}</EyebrowLabel>
        <div className="lw-recommend-headline">
          Here's what I'd book.{' '}
          <span className="lw-recommend-headline-gray">{recommend.headlineGray}</span>
        </div>
      </div>

      <LocationCard name={recommend.locationName} address={recommend.locationAddress} />

      <Card>
        <div className="lw-recommend-window">
          <EyebrowLabel>Recommended pickup window</EyebrowLabel>
          <BigNumber size="md">{recommend.windowValue}</BigNumber>
          <p className="lw-recommend-day">{recommend.dayLine}</p>
        </div>
        <Divider />
        <div className="lw-recommend-odds">
          <span className="lw-recommend-odds-label">{recommend.oddsLabel}</span>
          <span className="lw-recommend-odds-value" style={{ color: recommend.oddsColor }}>
            {recommend.oddsValue}
          </span>
        </div>
        <p className="lw-recommend-explanation">{recommend.explanation}</p>
      </Card>

      <Button variant="primary" onClick={recommend.onConfirm}>
        Confirm
      </Button>
      <NotNowButton onClick={recommend.onNotNow} />
    </>
  )
}
