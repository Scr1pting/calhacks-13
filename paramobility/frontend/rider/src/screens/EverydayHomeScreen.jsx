import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import Divider from '../components/Divider.jsx'
import KeyValueRow from '../components/KeyValueRow.jsx'
import './EverydayHomeScreen.css'

// Screen 3c: "Everyday home".
export default function EverydayHomeScreen({ everyday }) {
  return (
    <>
      <Headline lead="Your rides are taken care of.">
        Next up is {everyday.next.title.toLowerCase()} on {everyday.next.day}.
        I'll watch the trip for you.
      </Headline>

      <Card>
        <EyebrowLabel>Next ride {'·'} {everyday.next.date}</EyebrowLabel>
        <div className="lw-everyday-title">
          {everyday.next.title}, {everyday.next.location}
        </div>
        <div className="lw-everyday-odds">
          <span className="lw-everyday-odds-value">{everyday.next.oddsValue}</span>
          <span className="lw-everyday-odds-label">
            chance of arriving by {everyday.next.arriveByTime}
          </span>
        </div>
        <Divider />
        <KeyValueRow label="Pickup window" value={everyday.next.pickupWindow} />
      </Card>

      {everyday.alsoBooked.length > 0 && (
      <div className="lw-also-booked">
        <EyebrowLabel>Also booked</EyebrowLabel>
        <div className="lw-also-booked-list" role="list">
          {everyday.alsoBooked.map((item, i) => (
            <div
              key={item.title + item.date}
              className={`lw-also-booked-row${i === 0 ? ' lw-also-booked-row-first' : ''}`}
            >
              <div className="lw-also-booked-info">
                <span className="lw-also-booked-title">{item.title}</span>
                <span className="lw-also-booked-date">{item.date}</span>
              </div>
              <span className="lw-also-booked-value">{item.oddsText}</span>
            </div>
          ))}
        </div>
      </div>
      )}
    </>
  )
}
