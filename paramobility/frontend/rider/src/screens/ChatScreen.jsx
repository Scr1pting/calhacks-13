import { Fragment } from 'react'
import Button from '../components/Button.jsx'
import EyebrowLabel from '../components/EyebrowLabel.jsx'
import BigNumber from '../components/BigNumber.jsx'
import Divider from '../components/Divider.jsx'
import './ChatScreen.css'

// Screens 7 / 7b: "Ask Leeway". Always the thread, even with zero messages
// yet — no separate "What can I help with?" placeholder screen.
export default function ChatScreen({ chat }) {
  return (
    <div className="lw-chat-thread-outer" aria-live="polite">
      <div className="lw-chat-thread-inner">
        {chat.messages.map((m, i) => (
          <Fragment key={i}>
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
          </Fragment>
        ))}
        {chat.typing && <p className="lw-chat-typing">{'Leeway is checking…'}</p>}
      </div>
    </div>
  )
}
