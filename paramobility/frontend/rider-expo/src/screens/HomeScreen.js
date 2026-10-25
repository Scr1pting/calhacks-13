import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import EyebrowLabel from '../components/EyebrowLabel'
import BigNumber from '../components/BigNumber'
import Divider from '../components/Divider'
import KeyValueRow from '../components/KeyValueRow'
import LocationCard from '../components/LocationCard'
import Button from '../components/Button'
import { colors, fonts, type } from '../theme/tokens'

// Screens 3 ("Ride booked, future day") and 3b ("Day of ride") — the same
// layout, with copy that changes on `home.today`.
export default function HomeScreen({ home }) {
  return (
    <>
      <Headline lead={home.headlineLead}>{home.headlineGray}</Headline>

      <Card>
        <View style={styles.forecastMain}>
          <EyebrowLabel>{home.oddsEyebrow}</EyebrowLabel>
          <BigNumber size="xl" color={colors.success}>
            {home.oddsValue}
          </BigNumber>
          <Text style={styles.note}>Based on similar trips over the last 3 months.</Text>
        </View>
        <Divider />
        <KeyValueRow label="Pickup window" value={home.pickupWindow} />
      </Card>

      <LocationCard name={home.locationName} address={home.locationAddress} />

      <Text style={styles.monitor}>{home.monitorText}</Text>

      {home.hasSecondary && home.secondary && (
        <View style={styles.secondaryRow}>
          <View style={styles.secondaryInfo}>
            <Text style={styles.secondaryTitle}>
              {home.secondary.visitReason} {'·'} {home.secondary.date}
            </Text>
            <Text style={styles.secondarySub}>Needs a ride</Text>
          </View>
          <Button variant="compact-solid" onPress={home.onPlanSecondary}>
            Plan
          </Button>
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  forecastMain: { gap: 6 },
  note: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  monitor: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
    paddingHorizontal: 4,
  },
  secondaryRow: {
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderSecondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  secondaryInfo: { gap: 2, flexShrink: 1 },
  secondaryTitle: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  secondarySub: { fontFamily: fonts.regular, fontSize: type.caption, color: colors.textSecondary },
})
