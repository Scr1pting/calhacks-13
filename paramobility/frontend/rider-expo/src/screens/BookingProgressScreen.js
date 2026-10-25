import Headline from '../components/Headline'
import TaskList from '../components/TaskList'
import Button from '../components/Button'
import CallTranscript from '../components/CallTranscript'
import { PhoneIcon } from '../components/icons'

// Screens 2b / 6b: "Leeway working" — books with EBP, or shows the plan
// being worked out, depending on `working.*` from the flow hook. "Hear the
// call" shows the EBP reservations call's transcript once the call has started.
export default function BookingProgressScreen({ working }) {
  return (
    <>
      <Headline lead={working.headlineLead}>{working.headlineGray}</Headline>
      <TaskList tasks={working.tasks} />
      {working.transcript?.length > 0 && (
        <Button variant="compact-outline" icon={PhoneIcon} onPress={working.onToggleTranscript}>
          {working.showTranscript ? 'Hide the call' : 'Hear the call'}
        </Button>
      )}
      {working.showTranscript && <CallTranscript lines={working.transcript} />}
      {working.done && (
        <Button variant="primary" disabled={working.nextDisabled} onPress={working.onNext}>
          {working.nextLabel}
        </Button>
      )}
    </>
  )
}
