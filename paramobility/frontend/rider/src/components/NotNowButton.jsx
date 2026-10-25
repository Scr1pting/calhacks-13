import './NotNowButton.css'

// A plain text link under a screen's primary action, for backing out to
// "Chat as home" without taking that action — used on screens reached from
// home that have their own commit button (discover, recommend).
export default function NotNowButton({ onClick, children = 'Not now' }) {
  return (
    <button type="button" className="lw-not-now" onClick={onClick}>
      {children}
    </button>
  )
}
