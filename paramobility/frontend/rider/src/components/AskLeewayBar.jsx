import './AskLeewayBar.css'

// The bottom bar. In `mode="button"` (every screen except chat) it's a
// button that opens chat. In `mode="input"` (the chat screen) it becomes a
// real text field, and the mic becomes a send button once there's a draft.
//
// The mic is tap-to-talk: tap (or press Space/Enter) to start, speak, tap
// again to stop. `voice.state` is idle | listening | thinking | speaking.
const STATUS = {
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Leeway is speaking…',
}

export default function AskLeewayBar({
  mode = 'button',
  onOpenChat,
  value = '',
  onChange,
  onKeyDown,
  onSend,
  voice = { state: 'idle' },
}) {
  const listening = voice.state === 'listening'
  const status = STATUS[voice.state]
  const hasDraft = mode === 'input' && value.trim().length > 0 && !status

  const toggleTalk = () => (listening ? voice.onHoldEnd?.() : voice.onHoldStart?.())

  return (
    <div className={`lw-ask-bar ${listening ? 'lw-ask-bar-listening' : ''}`}>
      {mode === 'input' && !status ? (
        <input
          aria-label="Message Leeway"
          placeholder="Ask Leeway"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          className="lw-ask-input"
        />
      ) : (
        <button type="button" className="lw-ask-text" onClick={onOpenChat} aria-live="polite">
          {status || 'Ask Leeway'}
        </button>
      )}

      {hasDraft ? (
        <button
          type="button"
          className="lw-mic-button"
          aria-label="Send"
          onClick={onSend}
        >
          <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
            <path
              d="M8 16 V2 M2 8 L8 2 L14 8"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          className="lw-mic-button"
          aria-label={listening ? 'Stop talking to Leeway' : 'Talk to Leeway'}
          aria-pressed={listening}
          disabled={voice.state === 'thinking'}
          onClick={toggleTalk}
        >
          <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true">
            <rect x="5" y="1" width="6" height="11" rx="3" fill="#FFFFFF" />
            <path
              d="M2 9 A6 6 0 0 0 14 9 M8 15 V19"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
