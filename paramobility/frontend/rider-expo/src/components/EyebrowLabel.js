import { StyleSheet, Text } from 'react-native'
import { colors, fonts, type } from '../theme/tokens'

// Small uppercase label above card titles (e.g. "CHANCE OF ARRIVING BY
// 10:30 AM", "PICKUP WINDOW").
export default function EyebrowLabel({ children }) {
  return <Text style={styles.eyebrow}>{String(children).toUpperCase()}</Text>
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: fonts.medium,
    fontSize: type.eyebrow,
    letterSpacing: type.eyebrow * 0.08,
    color: colors.textSecondary,
  },
})
