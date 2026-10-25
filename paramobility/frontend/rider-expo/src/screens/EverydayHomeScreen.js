import { StyleSheet, Text, View } from 'react-native'
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
      <Headline lead="Your rides are taken care of.">
        Next up is {everyday.next.title.toLowerCase()} on Tuesday. I'll remind
        you the night before.
      </Headline>

      <Card>
        <EyebrowLabel>
          Next ride {'·'} {everyday.next.date}
        </EyebrowLabel>
        <Text style={styles.title}>
          {everyday.next.title}, {everyday.next.location}
        </Text>
        <View style={styles.odds}>
          <Text style={styles.oddsValue}>{everyday.next.oddsValue}</Text>
          <Text style={styles.oddsLabel}>chance of arriving by {everyday.next.arriveByTime}</Text>
        </View>
        <Divider />
        <KeyValueRow label="Pickup window" value={everyday.next.pickupWindow} />
      </Card>

      <View style={styles.alsoBooked}>
        <EyebrowLabel>Also booked</EyebrowLabel>
        <View style={styles.alsoBookedList}>
          {everyday.alsoBooked.map((item, i) => (
            <View
              key={item.title + item.date}
              style={[styles.alsoBookedRow, i === 0 && styles.alsoBookedRowFirst]}
            >
              <View style={styles.alsoBookedInfo}>
                <Text style={styles.alsoBookedTitle}>{item.title}</Text>
                <Text style={styles.alsoBookedDate}>{item.date}</Text>
              </View>
              <Text style={styles.alsoBookedValue}>{item.oddsText}</Text>
            </View>
          ))}
        </View>
      </View>
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
    color: colors.success,
  },
  oddsLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  alsoBooked: { gap: 8 },
  alsoBookedList: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.row,
    paddingHorizontal: 18,
    ...cardShadow,
  },
  alsoBookedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  alsoBookedRowFirst: { borderTopWidth: 0 },
  alsoBookedInfo: { gap: 2 },
  alsoBookedTitle: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  alsoBookedDate: { fontFamily: fonts.regular, fontSize: type.caption, color: colors.textSecondary },
  alsoBookedValue: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.success },
})
