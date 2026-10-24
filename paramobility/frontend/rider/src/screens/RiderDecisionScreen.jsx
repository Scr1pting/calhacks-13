import Headline from '../components/Headline.jsx'
import SelectRow from '../components/SelectRow.jsx'
import StatusPill from '../components/StatusPill.jsx'
import Button from '../components/Button.jsx'
import './RiderDecisionScreen.css'

// Screen 6: "Rider decision". No bottom bar on this screen.
export default function RiderDecisionScreen({ decision }) {
  return (
    <>
      <Headline lead="Kaiser can't see you late today.">
        Dr. Patel's next opening is Thursday at 9:00 AM. Here's what I'd do.
      </Headline>

      <div role="radiogroup" aria-label="Options" className="lw-decision-options">
        {decision.options.map((option) => (
          <SelectRow
            key={option.key}
            as="radio"
            selected={option.selected}
            onClick={option.onSelect}
          >
            <div className="lw-decision-title-row">
              <span className="lw-decision-title">{option.title}</span>
              {option.tag && <StatusPill tone="green">{option.tag}</StatusPill>}
            </div>
            <span className="lw-decision-sub">{option.sub}</span>
          </SelectRow>
        ))}
      </div>

      <Button variant="primary" onClick={decision.onApprove}>
        {decision.approveLabel}
      </Button>
    </>
  )
}
