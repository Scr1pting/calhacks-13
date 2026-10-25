import Headline from '../components/Headline'
import TaskList from '../components/TaskList'
import Button from '../components/Button'

// Screens 2b / 6b: "Leeway working" — books with EBP, moves the rider to
// Thursday, or checks accessible rides, depending on `working.*`.
export default function BookingProgressScreen({ working }) {
  return (
    <>
      <Headline lead={working.headlineLead}>{working.headlineGray}</Headline>
      <TaskList tasks={working.tasks} />
      {working.done && (
        <Button variant="primary" onPress={working.onNext}>
          {working.nextLabel}
        </Button>
      )}
    </>
  )
}
