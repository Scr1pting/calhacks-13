import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fonts, type } from '../theme/tokens'

// What went wrong (the flow's `error`), with a button to dismiss it. At the
// top of a page's content, and of the chat's.
export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>Something went wrong: {error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8}>
        <Text style={styles.errorClose}>×</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  error: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.errorBg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.errorText,
  },
  errorClose: {
    fontSize: 20,
    lineHeight: 20,
    color: colors.errorText,
  },
})
