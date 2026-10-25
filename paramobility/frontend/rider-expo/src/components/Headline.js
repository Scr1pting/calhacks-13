import { StyleSheet, Text } from 'react-native'
import { colors, fonts, type } from '../theme/tokens'

// A dark lead sentence followed by a gray continuation, as one paragraph —
// used at the top of every screen in the design.
export default function Headline({ lead, children }) {
  return (
    <Text style={styles.headline}>
      {lead} <Text style={styles.gray}>{children}</Text>
    </Text>
  )
}

const styles = StyleSheet.create({
  headline: {
    fontFamily: fonts.regular,
    fontSize: type.headline,
    lineHeight: type.headline * 1.2,
    letterSpacing: -type.headline * 0.02,
    color: colors.ink,
    paddingHorizontal: 4,
  },
  gray: {
    color: colors.textSecondary,
  },
})
