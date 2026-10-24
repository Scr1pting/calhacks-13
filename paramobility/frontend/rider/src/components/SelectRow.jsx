import './SelectRow.css'

// A selectable row — `as="checkbox"` for the calendar-discovery rows,
// `as="radio"` for the rider-decision rows. The row border and indicator
// fill follow `selected`; the row's own content is passed as children so
// each screen can lay out its own title/subtitle/tag.
export default function SelectRow({ as = 'checkbox', selected, onClick, children }) {
  return (
    <div
      role={as}
      aria-checked={selected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={`lw-select-row lw-select-row-${as}${selected ? ' lw-select-row-selected' : ''}`}
    >
      {as === 'checkbox' ? (
        <span className={`lw-checkbox-indicator${selected ? ' lw-checkbox-indicator-on' : ''}`}>
          {selected ? '✓' : ''}
        </span>
      ) : (
        <span className="lw-radio-indicator">
          <span className={`lw-radio-dot${selected ? ' lw-radio-dot-on' : ''}`} />
        </span>
      )}
      <div className="lw-select-content">{children}</div>
    </div>
  )
}
