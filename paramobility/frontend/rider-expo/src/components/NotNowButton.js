import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, fonts, hitMin, type } from '../theme/tokens'

// A plain text link under a screen's primary action, for backing out to
// "Chat as home" without taking that action — used on screens reached from
// home that have their own commit button (discover, recommend).
export default function NotNowButton({ onPress, children = 'Not now' }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.label}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    minHeight: hitMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.textSecondary,
  },
})
