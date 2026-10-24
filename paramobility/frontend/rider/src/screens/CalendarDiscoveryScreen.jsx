import Headline from '../components/Headline.jsx'
import SelectRow from '../components/SelectRow.jsx'
import Button from '../components/Button.jsx'
import './CalendarDiscoveryScreen.css'

// Screen 1: "Calendar discovery".
export default function CalendarDiscoveryScreen({ discover }) {
  return (
    <>
      <Headline lead="Let's plan ahead.">
        I found a few upcoming appointments in your calendar. Would you like
        me to arrange transportation?
      </Headline>

      <div
        role="group"
        aria-label="Appointments that may need a ride"
        className="lw-discover-list"
      >
        {discover.items.map((item) => (
          <SelectRow
            key={item.key}
            as="checkbox"
            selected={item.selected}
            onClick={item.onToggle}
          >
            <span className="lw-discover-title">{item.title}</span>
            <span className="lw-discover-sub">{item.when}</span>
            <span className="lw-discover-sub">{item.location}</span>
          </SelectRow>
        ))}
      </div>

      <p className="lw-discover-note">
        I skipped {discover.skipped} events that don't look like they need a
        ride, like work meetings and calls.
      </p>

      <Button
        variant="primary"
        disabled={discover.arrangeDisabled}
        onClick={discover.onArrange}
      >
        {discover.arrangeLabel}
      </Button>
    </>
  )
}
