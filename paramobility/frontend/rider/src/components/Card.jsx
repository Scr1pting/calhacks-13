import './Card.css'

// White, shadowed card — radius 28 by default, 20 ("small") for compact
// cards like the location card.
export default function Card({ size = 'default', className, children, ...rest }) {
  const base = size === 'small' ? 'lw-card lw-card-small' : 'lw-card'
  return (
    <div className={className ? `${base} ${className}` : base} {...rest}>
      {children}
    </div>
  )
}
