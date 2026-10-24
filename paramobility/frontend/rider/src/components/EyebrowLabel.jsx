import './EyebrowLabel.css'

// Small uppercase label used above card titles (e.g. "CHANCE OF ARRIVING BY
// 10:30 AM", "PICKUP WINDOW").
export default function EyebrowLabel({ children }) {
  return <div className="lw-eyebrow">{children}</div>
}
