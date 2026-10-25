import { StyleSheet, Text, View } from 'react-native'
import { cardShadow, colors, fonts, radii, type } from '../theme/tokens'

// The "Leeway working" task list — each task is {label, state}, state one
// of 'pending' | 'active' | 'done'.
export default function TaskList({ tasks }) {
  return (
    <View style={styles.list} accessibilityLiveRegion="polite">
      {tasks.map((task, i) => (
        <View key={i} style={[styles.row, i === 0 && styles.rowFirst]}>
          <View
            style={[
              styles.mark,
              task.state !== 'pending' && { borderColor: colors.ink },
              task.state === 'done' && { backgroundColor: colors.ink },
            ]}
          >
            {task.state === 'done' && <Text style={styles.markText}>{'✓'}</Text>}
          </View>
          <Text
            style={[styles.label, task.state !== 'pending' && { color: colors.ink }]}
          >
            {task.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.card,
    paddingHorizontal: 20,
    ...cardShadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 60,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowFirst: {
    borderTopColor: 'transparent',
  },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.ringPending,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    color: colors.white,
    fontSize: 13,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.textSecondary,
    flexShrink: 1,
  },
})
