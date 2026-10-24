import './Button.css'

// One button component covering every button variant in the design:
//   primary          – full-width, 56px, black (e.g. "Confirm")
//   secondary         – full-width, 52px, outlined (e.g. "Book a ride yourself")
//   compact-outline   – inline, 44px, outlined (e.g. "View calendar")
//   compact-solid     – inline, 44px, filled black (e.g. "Plan", chat actions)
// `background` lets a screen override the fill for a specific state (e.g.
// the purple "Listening in" background on the call screen's secondary
// button) without inventing a new variant.
export default function Button({
  variant = 'primary',
  onClick,
  disabled = false,
  icon,
  background,
  color,
  children,
}) {
  const style = {}
  if (background) style.background = background
  if (color) style.color = color
  return (
    <button
      type="button"
      className={`lw-btn lw-btn-${variant}`}
      style={style}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}
