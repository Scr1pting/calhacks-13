import './KeyValueRow.css'

// Label/value row, space-between and baseline-aligned — e.g. "Pickup window"
// / "9:15 AM – 9:45 AM".
export default function KeyValueRow({ label, value }) {
  return (
    <div className="lw-kv-row">
      <span className="lw-kv-label">{label}</span>
      <span className="lw-kv-value">{value}</span>
    </div>
  )
}
