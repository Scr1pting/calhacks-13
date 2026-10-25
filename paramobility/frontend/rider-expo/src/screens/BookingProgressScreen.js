import { useEffect } from 'react'
import Headline from '../components/Headline'
import TaskList from '../components/TaskList'
import Button from '../components/Button'
import CallTranscript from '../components/CallTranscript'
import { PhoneIcon } from '../components/icons'
import { success } from '../lib/haptics'

// Screens 2b / 6b: "Leeway working" — books with EBP, or shows the plan
// being worked out, depending on `working.*` from the flow hook. "Hear the
// call" shows the EBP reservations call's transcript once the call has started.
export default function BookingProgressScreen({ working }) {
  // Every step done: EBP confirmed the ride.
  const confirmed = working.tasks.length > 0 && working.tasks.every((t) => t.state === 'done')
  useEffect(() => {
    if (confirmed) success()
  }, [confirmed])

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
    </>
  )
}

// Fixed at the bottom by Page, once there's a next step.
export function WorkingActions({ working }) {
  if (!working.done) return null
  return (
    <Button variant="primary" disabled={working.nextDisabled} onPress={working.onNext}>
      {working.nextLabel}
    </Button>
  )
}
