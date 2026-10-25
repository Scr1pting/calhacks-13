import Svg, { Path, Rect } from 'react-native-svg'
import { colors } from '../theme/tokens'

// Small inline icons shared across compact-outline buttons and rows.

export const CalendarIcon = (
  <Svg width={16} height={16} viewBox="0 0 18 18">
    <Rect x={2} y={3} width={14} height={13} rx={2} fill="none" stroke={colors.ink} strokeWidth={2} />
    <Path d="M6 1 V5 M12 1 V5 M2 7 H16" stroke={colors.ink} strokeWidth={2} />
  </Svg>
)

export const PhoneIcon = (
  <Svg width={16} height={16} viewBox="0 0 18 18">
    <Path
      d="M3 2 H6.5 L8 6 L6 7.5 A9 9 0 0 0 10.5 12 L12 10 L16 11.5 V15 A1.5 1.5 0 0 1 14.5 16.5 A13 13 0 0 1 1.5 3.5 A1.5 1.5 0 0 1 3 2Z"
      fill="none"
      stroke={colors.ink}
      strokeWidth={1.7}
      strokeLinejoin="round"
    />
  </Svg>
)

export const ChevronIcon = (
  <Svg width={8} height={14} viewBox="0 0 8 14">
    <Path
      d="M1.5 1.5 L6.5 7 L1.5 12.5"
      fill="none"
      stroke={colors.textSecondary}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
)
