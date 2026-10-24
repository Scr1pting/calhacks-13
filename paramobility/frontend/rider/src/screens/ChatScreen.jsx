import Headline from '../components/Headline.jsx'
import Button from '../components/Button.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import BigNumber from '../components/BigNumber.jsx'
import Divider from '../components/Divider.jsx'
import './ChatScreen.css'

const ChevronIcon = (
  <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
    <path
      d="M1.5 1.5 L6.5 7 L1.5 12.5"
      fill="none"
      stroke="#6B6E72"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// Screens 7 / 7b: "Ask Leeway".
export default function ChatScreen({ chat }) {
  if (chat.isEmpty) {
    return (
      <>
        <Headline lead="What can I help with?">
          Ask about your rides, appointments or bookings. You can type or
          hold the mic to talk.
        </Headline>
        <div className="lw-chat-suggestions">
          {chat.suggestions.map((s) => (
            <button
              key={s.text}
              type="button"
              className="lw-chat-suggestion"
              onClick={s.onClick}
            >
              <span>{s.text}</span>
              {ChevronIcon}
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <div className="lw-chat-thread-outer" aria-live="polite">
      <div className="lw-chat-thread-inner">
        {chat.messages.map((m, i) => (
          <div key={i}>
            {m.isMe ? (
              <div className="lw-chat-bubble-me">{m.text}</div>
            ) : (
              <div className="lw-chat-agent">
                <div className="lw-chat-agent-text">{m.text}</div>
                {m.hasCard && (
                  <div className="lw-chat-card">
                    <div className="lw-chat-card-head">
                      <EyebrowLabel>{chat.rideCard.eyebrow}</EyebrowLabel>
                      <BigNumber size="sm">{chat.rideCard.window}</BigNumber>
                      <p className="lw-chat-card-subtitle">{chat.rideCard.subtitle}</p>
                    </div>
                    <Divider />
                    <div className="lw-chat-card-odds">
                      <span className="lw-chat-card-odds-label">{chat.rideCard.oddsLabel}</span>
                      <span className="lw-chat-card-odds-value">{chat.rideCard.oddsValue}</span>
                    </div>
                  </div>
                )}
                {m.hasActions && (
                  <div className="lw-chat-actions">
                    {m.actions.map((a) => (
                      <Button key={a.label} variant={a.variant} onClick={a.onClick}>
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {chat.typing && <p className="lw-chat-typing">{'Leeway is checking…'}</p>}
      </div>
    </div>
  )
}
