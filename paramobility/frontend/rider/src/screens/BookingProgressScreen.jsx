import Headline from '../components/Headline.jsx'
import TaskList from '../components/TaskList.jsx'
import Button from '../components/Button.jsx'

// Screens 2b / 6b: "Leeway working" — books with EBP, moves the rider to
// Thursday, or checks accessible rides, depending on `working.*` from the
// flow hook.
export default function BookingProgressScreen({ working }) {
  return (
    <>
      <Headline lead={working.headlineLead}>{working.headlineGray}</Headline>
      <TaskList tasks={working.tasks} />
      {working.done && (
        <Button variant="primary" onClick={working.onNext}>
          {working.nextLabel}
        </Button>
      )}
    </>
  )
}
