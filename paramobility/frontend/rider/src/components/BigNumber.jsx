import './BigNumber.css'

// Large display number — used for on-time odds and pickup windows.
// `size` picks the font size from the design's display scale (52/44/40/32);
// `color` defaults to the design's success green for on-time odds.
const SIZES = {
  xl: 'var(--lw-fs-display-xl)', // 52px
  lg: 'var(--lw-fs-display-lg)', // 44px
  md: 'var(--lw-fs-display-md)', // 40px
  sm: 'var(--lw-fs-display-sm)', // 32px
}

export default function BigNumber({ size = 'xl', color, children }) {
  return (
    <div
      className="lw-big-number"
      style={{ fontSize: SIZES[size], color: color || 'inherit' }}
    >
      {children}
    </div>
  )
}
