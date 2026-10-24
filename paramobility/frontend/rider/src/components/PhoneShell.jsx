import './PhoneShell.css'

// The phone frame, status bar and top bar from the design
// (design-reference/Leeway Denise Prototype.dc.html). `children` fills the
// scrollable content area; the bottom "Ask Leeway" bar is a separate
// component so screens that hide it (Recommended booking, Rider decision)
// can simply not render it.
export default function PhoneShell({ children, bottomBar, topBar = 'logo', onBack }) {
  return (
    <div className="lw-phone" data-screen-label="Phone">
      <div className="lw-status-bar" aria-hidden="true" />

      <div className="lw-top-bar">
        {topBar === 'back' ? (
          <button
            type="button"
            className="lw-back-button"
            aria-label="Back"
            onClick={onBack}
          >
            <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
              <path
                d="M8 2 L2 8 L8 14"
                fill="none"
                stroke="var(--lw-ink)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <svg width="30" height="30" viewBox="0 0 30 30" aria-label="Leeway">
            <path
              d="M3 18 C8 9 12 9 15 15 C18 21 22 21 27 12"
              fill="none"
              stroke="var(--lw-ink)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <button type="button" className="lw-menu-button" aria-label="Menu">
          <span />
          <span />
          <span />
        </button>
      </div>

      <div className="lw-content">{children}</div>

      {bottomBar}

      <div className="lw-home-indicator" aria-hidden="true" />
    </div>
  )
}
