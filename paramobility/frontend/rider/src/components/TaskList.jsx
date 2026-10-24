import './TaskList.css'

// The "Leeway working" task list — each task is {label, state}, state one
// of 'pending' | 'active' | 'done'.
export default function TaskList({ tasks }) {
  return (
    <div className="lw-task-list" aria-live="polite">
      {tasks.map((task, i) => (
        <div
          key={i}
          className={`lw-task-row${i === 0 ? ' lw-task-row-first' : ''}`}
        >
          <span className={`lw-task-mark lw-task-mark-${task.state}`}>
            {task.state === 'done' ? '✓' : ''}
          </span>
          <span className={`lw-task-label lw-task-label-${task.state}`}>
            {task.label}
          </span>
        </div>
      ))}
    </div>
  )
}
