import Headline from '../components/Headline.jsx'
import Card from '../components/Card.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import Divider from '../components/Divider.jsx'
import StatusPill from '../components/StatusPill.jsx'
import { ChevronIcon } from '../components/icons.jsx'
import './ChatHomeScreen.css'

// Screen 7c: "Chat as home" — an alternative home screen where the Ask
// Leeway input bar is the main surface. Widgets above it show the next
// ride and the calendar appointments that still need one. Sending a
// message (typed, mic, or a chip) opens the normal chat thread; see
// useLeewayFlow's `openChat`.
export default function ChatHomeScreen({ chatHome }) {
  return (
    <>
      <Headline lead="Good morning, Denise.">What can I help with?</Headline>

      {chatHome.nextRide && (
        <Card
          role="button"
          tabIndex={0}
          className="lw-chathome-next"
          onClick={chatHome.nextRide.onClick}
        >
          <div className="lw-chathome-next-head">
            <EyebrowLabel>NEXT RIDE · {chatHome.nextRide.dateCaps}</EyebrowLabel>
            {ChevronIcon}
          </div>
          <div className="lw-chathome-next-window">{chatHome.nextRide.window}</div>
          <p className="lw-chathome-next-title">{chatHome.nextRide.title}</p>
          <Divider />
          <div className="lw-chathome-next-odds">
            <span className="lw-chathome-next-odds-label">Chance of arriving by {chatHome.nextRide.time}</span>
            <span className="lw-chathome-next-odds-value" style={{ color: chatHome.nextRide.oddsColor }}>
              {chatHome.nextRide.oddsValue}
            </span>
          </div>
        </Card>
      )}

      {chatHome.comingUp && (
        <Card>
          <EyebrowLabel>Coming up</EyebrowLabel>
          <div className="lw-chathome-upcoming-list">
            {chatHome.comingUp.items.map((item, i) => (
              <div key={item.key} className={`lw-chathome-upcoming-row${i === 0 ? ' lw-chathome-upcoming-row-first' : ' lw-chathome-upcoming-row-divided'}`}>
                <div className="lw-chathome-upcoming-info">
                  <span className="lw-chathome-upcoming-title">{item.title}</span>
                  <span className="lw-chathome-upcoming-date">{item.date}</span>
                </div>
                {item.status ? (
                  <StatusPill tone="green">{item.status}</StatusPill>
                ) : (
                  <button type="button" className="lw-chathome-book-btn" onClick={item.onAction}>
                    {item.actionLabel}
                  </button>
                )}
              </div>
            ))}
            <div className="lw-chathome-upcoming-divider">
              <Divider />
            </div>
            <button type="button" className="lw-chathome-seeall" onClick={chatHome.comingUp.onSeeAll}>
              <span>See all appointments</span>
              {ChevronIcon}
            </button>
          </div>
        </Card>
      )}

      <div className="lw-chathome-suggestions">
        {chatHome.suggestions.map((s) => (
          <button key={s.text} type="button" className="lw-chathome-chip" onClick={s.onClick}>
            {s.text}
          </button>
        ))}
      </div>
    </>
  )
}
