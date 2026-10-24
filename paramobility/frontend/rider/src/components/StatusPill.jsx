import './StatusPill.css'

// Small status label — green for a positive state ("Rescheduled",
// "Recommended"), purple for an in-progress one ("On a call", "Listening in").
export default function StatusPill({ tone = 'green', children }) {
  return <span className={`lw-pill lw-pill-${tone}`}>{children}</span>
}
