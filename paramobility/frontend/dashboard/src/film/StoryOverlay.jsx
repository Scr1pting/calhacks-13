import { clock } from '../sim/fleet.js'
import { filmLength, sceneAt } from './script.js'

// The story's words: one centred caption at a time, the pickup-window
// timeline once the window matters, and the closing card.
export default function StoryOverlay({ fleet, maria, scenes, view, onExit, onReplay }) {
  const { elapsed } = view.film
  const { scene, p } = sceneAt(scenes, elapsed)
  const title = typeof scene.title === 'function' ? scene.title(view.t, p) : scene.title
  const progress = Math.min(1, elapsed / filmLength(scenes))
  // The first caption waits for Maria's dot to pop in.
  const delay = scene.id === 'maria' ? 0.9 : 0

  return (
    <div className="film story">
      {scene.cut && <div key={`cut-${scene.id}`} className="film-cut" />}
      <button type="button" className="film-exit" onClick={onExit}>
        Exit · Esc
      </button>

      {scene.end ? (
        <StoryEnd city={scene.fleet} onReplay={onReplay} onExit={onExit} />
      ) : (
        <section key={scene.id} className="story-caption" aria-live="polite" style={{ animationDelay: `${delay}s` }}>
          <h2 className="story-title">{title}</h2>
          <p className="story-line" style={{ animationDelay: `${delay + 0.25}s` }}>
            {scene.line}
          </p>
        </section>
      )}
      {scene.timeline && <Timeline fleet={fleet} maria={maria} scene={scene} t={view.t} />}

      {view.film.stepped && (
        <div className="film-keys" aria-hidden="true">
          ← → · {scenes.indexOf(scene) + 1} / {scenes.length}
        </div>
      )}
      <div className="film-progress" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}

// 10:15 to 11:45, roughly: the window, the appointment, the latest pickup
// that still makes it, now, and the pickup.
function Timeline({ fleet, maria, scene, t }) {
  const appointment = clockMinutes(fleet.meta.persona.appointment)
  const from = maria.windowStart - 15
  const to = appointment + 22
  const x = (m) => `${(100 * (m - from)) / (to - from)}%`
  const windowEnd = maria.windowStart + 30
  const deadline = appointment - Math.round(maria.dropoff.t - maria.pickup.t)
  const picked = t >= maria.pickup.t && scene.id !== 'leeway'
  const now = Math.min(Math.max(t, from), to)

  return (
    <div className="story-timeline" aria-hidden="true">
      <div className="tl-axis" />
      <div className="tl-window" style={{ left: x(maria.windowStart), width: `calc(${x(windowEnd)} - ${x(maria.windowStart)})` }}>
        <span>Pickup window</span>
      </div>
      {t > windowEnd && (
        <div
          className="tl-overdue"
          style={{ left: x(windowEnd), width: `calc(${x(Math.min(t, maria.pickup.t))} - ${x(windowEnd)})` }}
        />
      )}
      {scene.deadline && (
        <div className="tl-deadline" style={{ left: x(deadline) }}>
          <span>Latest pickup {clock(deadline).replace(/ [AP]M$/, '')}</span>
        </div>
      )}
      {scene.leewayCall != null && (
        <div className="tl-call" style={{ left: x(scene.leewayCall) }}>
          <span>Leeway calls ahead</span>
        </div>
      )}
      <div className="tl-mark" style={{ left: x(appointment) }}>
        <span>{fleet.meta.persona.purpose === 'dialysis' ? 'Dialysis' : 'Appointment'} {fleet.meta.persona.appointment}</span>
      </div>
      {picked ? (
        <div className="tl-pickup" style={{ left: x(maria.pickup.t) }}>
          <span>Picked up {clock(maria.pickup.t).replace(/ [AP]M$/, '')}</span>
        </div>
      ) : (
        scene.leewayCall == null && (
          <div className="tl-now" style={{ left: x(now) }}>
            <span>{clock(now).replace(/ [AP]M$/, '')}</span>
          </div>
        )
      )}
    </div>
  )
}

function clockMinutes(s) {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

// Centred on the blank page, or, over the city, on a gradient that leaves the
// right of the screen to the moving fleet.
export function StoryEnd({ city, onReplay, onExit }) {
  return (
    <section className={city ? 'story-end city' : 'story-end'} aria-live="polite">
      <h1 className="story-brand">Leeway</h1>
      <p className="story-promise">Plans for the bad days.</p>
      <p className="story-points">
        It picks the pickup window for the certainty a rider chooses, asks the clinic how late is too late, and
        calls ahead before the rider is late.
      </p>
      <div className="film-end-actions">
        <button type="button" className="btn btn-solid" onClick={onReplay}>
          Play again
        </button>
        <button type="button" className="btn btn-outline" onClick={onExit}>
          Explore the day
        </button>
      </div>
    </section>
  )
}
