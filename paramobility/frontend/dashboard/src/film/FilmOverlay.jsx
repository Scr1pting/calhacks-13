import { clock, vanState } from '../sim/fleet.js'
import { filmLength, sceneAt } from './script.js'

// What the film shows over the map: the clock, the scene's caption, Maria's
// ride card, a thin progress line, and the closing card. Captions are keyed by
// scene, so each one fades in fresh; a cut opens with a soft flash.
export default function FilmOverlay({ fleet, maria, scenes, view, onExit, onReplay }) {
  const { elapsed } = view.film
  const { scene, p } = sceneAt(scenes, elapsed)
  const title = typeof scene.title === 'function' ? scene.title(view.t, p) : scene.title
  const progress = Math.min(1, elapsed / filmLength(scenes))

  return (
    <div className="film">
      <div className="film-vignette" />
      {scene.cut && <div key={`cut-${scene.id}`} className="film-cut" />}
      {!scene.hideClock && (
        <div className="film-clock" aria-live="off">
          {clock(view.t)}
        </div>
      )}
      <button type="button" className="film-exit" onClick={onExit}>
        Exit film · Esc
      </button>
      {scene.info && <RideCard fleet={fleet} maria={maria} scene={scene} t={view.t} />}

      {scene.end ? (
        <EndCard key="end" onReplay={onReplay} onExit={onExit} />
      ) : (
        <section key={scene.id} className="film-caption" aria-live="polite">
          <div className="film-eyebrow">{scene.eyebrow}</div>
          <h2 className="film-title">{title}</h2>
          <p className="film-line">{scene.line}</p>
        </section>
      )}

      {view.film.stepped && (
        <div className="film-keys" aria-hidden="true">
          ← → · {scenes.indexOf(scene) + 1} / {scenes.length}
        </div>
      )}
      <div className="film-progress" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}

// Maria's ride as the rider sees it: the window, the wait so far, and the
// van, which riders can't see at all until the film follows it.
function RideCard({ fleet, maria, scene, t }) {
  const persona = fleet.meta.persona
  const picked = t >= maria.pickup.t
  let waiting = `${Math.floor(t - maria.windowStart)} min`
  if (picked) waiting = `Picked up ${clock(maria.pickup.t)}`
  else if (t < maria.windowStart) waiting = 'Window opens soon'
  const van = scene.follow != null && vanState(fleet.vansById[scene.follow], t)

  return (
    <aside className="film-info" aria-label={`${persona.name}’s ride`}>
      <div className="film-eyebrow">{persona.name}’s ride</div>
      <dl>
        <dt>Pickup window</dt>
        <dd>
          {maria.pickup.window[0]} – {maria.pickup.window[1]}
        </dd>
        <dt>{persona.purpose === 'dialysis' ? 'Dialysis' : 'Appointment'}</dt>
        <dd>{persona.appointment}</dd>
        <dt>Waiting</dt>
        <dd className={!picked && t > maria.windowStart + 30 ? 'warn' : ''}>{waiting}</dd>
        <dt>Van {maria.van_id}</dt>
        <dd className={van ? 'warn' : 'gray'}>{van ? `${Math.round(van.behind)} min behind plan` : 'No live location'}</dd>
      </dl>
    </aside>
  )
}

function EndCard({ onReplay, onExit }) {
  return (
    <section className="film-end" aria-live="polite">
      <div className="film-eyebrow">Paramobility · Cal Hacks 13</div>
      <h1 className="film-brand">Leeway</h1>
      <p className="film-promise">Plans for the bad days, so riders don’t have to arrive an hour early.</p>
      <ul className="film-points">
        <li>
          <b>Plans</b> the pickup window for the certainty the rider chooses.
        </li>
        <li>
          <b>Asks</b> the clinic how late is too late.
        </li>
        <li>
          <b>Watches</b> the ride, and calls the clinic before the rider is late.
        </li>
      </ul>
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
