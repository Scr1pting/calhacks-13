import Card from './Card.jsx'
import './LocationCard.css'

// Appointment name + address with a decorative map thumbnail. The thumbnail
// is recreated from the design's CSS shapes (two "roads", a green patch, a
// pin) — the design system has no raster map assets.
export default function LocationCard({ name, address }) {
  return (
    <Card size="small" className="lw-location-card">
      <div className="lw-location-info">
        <div className="lw-location-name">
          <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true">
            <polygon points="1,1 13,6 7.5,7.5 6,13" fill="var(--lw-ink)" />
          </svg>
          {name}
        </div>
        <div className="lw-location-address">{address}</div>
      </div>
      <div className="lw-map-thumb" role="img" aria-label={`Map showing ${name}`}>
        <div className="lw-map-road lw-map-road-1" />
        <div className="lw-map-road lw-map-road-2" />
        <div className="lw-map-patch" />
        <div className="lw-map-pin" />
      </div>
    </Card>
  )
}
