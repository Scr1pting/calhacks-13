import './Headline.css'

// A dark lead sentence followed by a gray continuation, as one paragraph —
// used at the top of every screen in the design.
export default function Headline({ lead, children }) {
  return (
    <div className="lw-headline">
      {lead} <span className="lw-headline-gray">{children}</span>
    </div>
  )
}
