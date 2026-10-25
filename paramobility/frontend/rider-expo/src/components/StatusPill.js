import { StyleSheet, Text, View } from 'react-native'
import { colors, fonts, radii, type } from '../theme/tokens'

// Small status label — green for a positive state ("Rescheduled",
// "Recommended"), purple for an in-progress one ("On a call", "Listening in").
export default function StatusPill({ tone = 'green', children }) {
  const isGreen = tone === 'green'
  return (
    <View style={[styles.pill, { backgroundColor: isGreen ? colors.successBg : colors.accentBg }]}>
      <Text style={[styles.text, { color: isGreen ? colors.success : colors.accent }]}>
        {children}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
  },
})
