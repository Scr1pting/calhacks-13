import { StyleSheet, Text, View } from 'react-native'
import EyebrowLabel from '../components/EyebrowLabel'
import Card from '../components/Card'
import BigNumber from '../components/BigNumber'
import Divider from '../components/Divider'
import LocationCard from '../components/LocationCard'
import Button from '../components/Button'
import { colors, fonts, type } from '../theme/tokens'

// Screen 2: "Recommended booking". No bottom bar on this screen.
export default function RecommendedBookingScreen({ recommend }) {
  return (
    <>
      <View style={styles.head}>
        <EyebrowLabel>{recommend.stepLabel}</EyebrowLabel>
        <Text style={styles.headline}>
          Here's what I'd book.{' '}
          <Text style={styles.headlineGray}>{recommend.headlineGray}</Text>
        </Text>
      </View>

      <LocationCard name={recommend.locationName} address={recommend.locationAddress} />

      <Card>
        <View style={styles.window}>
          <EyebrowLabel>Recommended pickup window</EyebrowLabel>
          <BigNumber size="md">{recommend.windowValue}</BigNumber>
          <Text style={styles.day}>{recommend.dayLine}</Text>
        </View>
        <Divider />
        <View style={styles.odds}>
          <Text style={styles.oddsLabel}>{recommend.oddsLabel}</Text>
          <Text style={styles.oddsValue}>{recommend.oddsValue}</Text>
        </View>
        <Text style={styles.explanation}>{recommend.explanation}</Text>
      </Card>

      <Button variant="primary" onPress={recommend.onConfirm}>
        Confirm
      </Button>
    </>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8, paddingHorizontal: 4 },
  headline: {
    fontFamily: fonts.regular,
    fontSize: type.headline,
    lineHeight: type.headline * 1.2,
    letterSpacing: -type.headline * 0.02,
    color: colors.ink,
  },
  headlineGray: { color: colors.textSecondary },
  window: { gap: 6 },
  day: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  odds: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  oddsLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  oddsValue: { fontFamily: fonts.medium, fontSize: 20, color: colors.success },
  explanation: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
  },
})
