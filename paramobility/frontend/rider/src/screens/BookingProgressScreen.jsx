import Headline from '../components/Headline.jsx'
import TaskList from '../components/TaskList.jsx'
import Button from '../components/Button.jsx'
import CallTranscript from '../components/CallTranscript.jsx'
import { PhoneIcon } from '../components/icons.jsx'

// Screens 2b / 6b: "Leeway working" — books with EBP, moves the rider to
// Thursday, or checks accessible rides, depending on `working.*` from the
// flow hook. "Hear the call" shows the EBP reservations call's transcript
// once the call has started.
export default function BookingProgressScreen({ working }) {
  return (
    <>
      <Headline lead={working.headlineLead}>{working.headlineGray}</Headline>
      <TaskList tasks={working.tasks} />
      {working.transcript?.length > 0 && (
        <Button variant="compact-outline" icon={PhoneIcon} onClick={working.onToggleTranscript}>
          {working.showTranscript ? 'Hide the call' : 'Hear the call'}
        </Button>
      )}
      {working.showTranscript && <CallTranscript lines={working.transcript} />}
      {working.done && (
        <Button variant="primary" disabled={working.nextDisabled} onClick={working.onNext}>
          {working.nextLabel}
        </Button>
      )}
    </>
  )
}
