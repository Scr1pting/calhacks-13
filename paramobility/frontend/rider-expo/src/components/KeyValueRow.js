import { StyleSheet, Text, View } from 'react-native'
import { colors, fonts, type } from '../theme/tokens'

// Label/value row, space-between — e.g. "Pickup window" / "9:15 AM – 9:45 AM".
export default function KeyValueRow({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {typeof value === 'string' ? <Text style={styles.value}>{value}</Text> : value}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    color: colors.textSecondary,
  },
  value: {
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.ink,
  },
})
