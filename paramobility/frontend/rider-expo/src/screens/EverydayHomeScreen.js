import { Pressable, StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import EyebrowLabel from '../components/EyebrowLabel'
import Divider from '../components/Divider'
import KeyValueRow from '../components/KeyValueRow'
import { cardShadow, colors, fonts, radii, type } from '../theme/tokens'

// Screen 3c: "Everyday home".
export default function EverydayHomeScreen({ everyday }) {
  return (
    <>
      {everyday.next ? (
        <Headline lead="Your rides are taken care of.">
          Next up is {everyday.next.title.toLowerCase()} on {everyday.next.day}. I'll watch the trip for
          you.
        </Headline>
      ) : (
        <Headline lead="Nothing booked yet.">Here's what's coming up on your calendar.</Headline>
      )}

      {everyday.next && (
        <Card>
          <EyebrowLabel>
            Next ride {'·'} {everyday.next.date}
          </EyebrowLabel>
          <Text style={styles.title}>
            {everyday.next.title}, {everyday.next.location}
          </Text>
          <View style={styles.odds}>
            <Text style={[styles.oddsValue, { color: everyday.next.oddsColor }]}>{everyday.next.oddsValue}</Text>
            <Text style={styles.oddsLabel}>chance of arriving by {everyday.next.arriveByTime}</Text>
          </View>
          <Divider />
          <KeyValueRow label="Pickup window" value={everyday.next.pickupWindow} />
        </Card>
      )}

      {everyday.alsoBooked.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionLabel}>
            <EyebrowLabel>Also booked</EyebrowLabel>
          </View>
          <View style={styles.list}>
            {everyday.alsoBooked.map((item, i) => (
              <View key={item.title + item.date} style={[styles.row, i === 0 && styles.rowFirst]}>
                <View style={styles.info}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowDate}>{item.date}</Text>
                </View>
                <Text style={[styles.rowValue, { color: item.oddsColor }]}>{item.oddsText}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {everyday.upcoming.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionLabel}>
            <EyebrowLabel>In the next 7 days</EyebrowLabel>
          </View>
          <View style={styles.list}>
            {everyday.upcoming.map((item, i) => (
              <View key={item.key} style={[styles.row, i === 0 && styles.rowFirst]}>
                <View style={styles.info}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowDate}>{item.date}</Text>
                </View>
                <Pressable accessibilityRole="button" style={styles.bookButton} onPress={item.onBook}>
                  <Text style={styles.bookLabel}>Book ride</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  odds: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  oddsValue: {
    fontFamily: fonts.regular,
    fontSize: type.displayXl,
    lineHeight: type.displayXl,
    letterSpacing: -type.displayXl * 0.03,
  },
  oddsLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  section: { gap: 8 },
  sectionLabel: { paddingHorizontal: 4 },
  list: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.row,
    paddingHorizontal: 18,
    paddingVertical: 8,
    ...cardShadow,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowFirst: { borderTopWidth: 0 },
  info: { gap: 2, flexShrink: 1 },
  rowTitle: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  rowDate: { fontFamily: fonts.regular, fontSize: type.caption, color: colors.textSecondary },
  rowValue: { fontFamily: fonts.regular, fontSize: type.secondary },
  bookButton: {
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.accentBg,
    justifyContent: 'center',
  },
  bookLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.accent },
})
