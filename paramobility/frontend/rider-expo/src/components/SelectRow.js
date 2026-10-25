import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radii } from '../theme/tokens'

// A selectable row — `as="checkbox"` for the calendar-discovery rows,
// `as="radio"` for the rider-decision rows.
export default function SelectRow({ as = 'checkbox', selected, onPress, children }) {
  return (
    <Pressable
      accessibilityRole={as}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.row,
        as === 'checkbox' ? styles.rowCheckbox : styles.rowRadio,
        { borderColor: selected ? colors.ink : colors.white },
      ]}
    >
      {as === 'checkbox' ? (
        <View style={[styles.checkboxIndicator, selected && { backgroundColor: colors.ink }]}>
          {selected && <Text style={styles.checkMark}>{'✓'}</Text>}
        </View>
      ) : (
        <View style={styles.radioIndicator}>
          <View style={[styles.radioDot, selected && { backgroundColor: colors.ink }]} />
        </View>
      )}
      <View style={[styles.content, as === 'radio' && { gap: 4 }]}>{children}</View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.row,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
  },
  rowCheckbox: {
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  rowRadio: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'flex-start',
  },
  checkboxIndicator: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: colors.white,
    fontSize: 14,
  },
  radioIndicator: {
    width: 24,
    height: 24,
    marginTop: 1,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  content: {
    flex: 1,
    gap: 3,
  },
})
