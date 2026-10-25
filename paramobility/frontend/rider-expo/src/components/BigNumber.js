import { StyleSheet, Text } from 'react-native'
import { colors, fonts, type } from '../theme/tokens'

// Large display number — used for on-time odds and pickup windows. `size`
// picks the font size from the design's display scale (52/44/40/32);
// `color` defaults to ink.
const SIZES = {
  xl: type.displayXl,
  lg: type.displayLg,
  md: type.displayMd,
  sm: type.displaySm,
}

export default function BigNumber({ size = 'xl', color = colors.ink, children }) {
  const fontSize = SIZES[size]
  return (
    <Text
      style={[
        styles.number,
        { fontSize, lineHeight: fontSize, letterSpacing: -fontSize * 0.03, color },
      ]}
    >
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  number: {
    fontFamily: fonts.regular,
  },
})
