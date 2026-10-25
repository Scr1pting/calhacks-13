import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import EyebrowLabel from '../components/EyebrowLabel'
import BigNumber from '../components/BigNumber'
import Divider from '../components/Divider'
import KeyValueRow from '../components/KeyValueRow'
import LocationCard from '../components/LocationCard'
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
          <BigNumber size="xl" color={home.oddsColor}>
            {home.oddsValue}
          </BigNumber>
          <Text style={styles.note}>Based on similar trips over the last 3 months.</Text>
        </View>
        <Divider />
        <KeyValueRow label="Pickup window" value={home.pickupWindow} />
      </Card>

      <LocationCard name={home.locationName} address={home.locationAddress} />

      <Text style={styles.monitor}>{home.monitorText}</Text>
    </>
  )
}

const styles = StyleSheet.create({
  forecastMain: { gap: 10 },
  note: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  monitor: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
    paddingHorizontal: 4,
  },
})
