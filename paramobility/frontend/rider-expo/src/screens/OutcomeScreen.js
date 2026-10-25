import { StyleSheet, Text, View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import Headline from '../components/Headline'
import Card from '../components/Card'
import StatusPill from '../components/StatusPill'
import Divider from '../components/Divider'
import LocationCard from '../components/LocationCard'
import Button from '../components/Button'
import { colors, fonts, type } from '../theme/tokens'

const CalendarIcon = (
  <Svg width={16} height={16} viewBox="0 0 18 18">
    <Rect x={2} y={3} width={14} height={13} rx={2} fill="none" stroke={colors.ink} strokeWidth={2} />
    <Path d="M6 1 V5 M12 1 V5 M2 7 H16" stroke={colors.ink} strokeWidth={2} />
  </Svg>
)

const PhoneIcon = (
  <Svg width={16} height={16} viewBox="0 0 18 18">
    <Path
      d="M3 2 H6.5 L8 6 L6 7.5 A9 9 0 0 0 10.5 12 L12 10 L16 11.5 V15 A1.5 1.5 0 0 1 14.5 16.5 A13 13 0 0 1 1.5 3.5 A1.5 1.5 0 0 1 3 2Z"
      fill="none"
      stroke={colors.ink}
      strokeWidth={1.7}
      strokeLinejoin="round"
    />
  </Svg>
)

// Screens 5 / 6c: "Outcome" (rescheduled, or moved to Thursday).
export default function OutcomeScreen({ outcome }) {
  return (
    <>
      <Headline lead={outcome.headlineLead}>{outcome.headlineGray}</Headline>

      <Card>
        <StatusPill tone="green">Rescheduled</StatusPill>
        <View style={styles.times}>
          <Text style={styles.was}>{outcome.was}</Text>
          <Text style={styles.now}>{outcome.now}</Text>
        </View>
        <Text style={styles.detail}>{outcome.detail}</Text>
        <Divider />
        <View style={styles.odds}>
          <Text style={styles.oddsLabel}>{outcome.oddsLabel}</Text>
          <Text style={[styles.oddsValue, { color: outcome.oddsColor }]}>{outcome.oddsValue}</Text>
        </View>
      </Card>

      {outcome.showLocation && (
        <LocationCard name={outcome.locationName} address={outcome.locationAddress} />
      )}

      <View style={styles.actions}>
        <Button variant="compact-outline" icon={CalendarIcon} onPress={outcome.onFirst}>
          {outcome.firstLabel}
        </Button>
        <Button variant="compact-outline" icon={PhoneIcon}>
          Hear the call
        </Button>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  times: { flexDirection: 'row', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' },
  was: { fontFamily: fonts.regular, fontSize: 20, color: colors.textSecondary, textDecorationLine: 'line-through' },
  now: {
    fontFamily: fonts.regular,
    fontSize: type.displayLg,
    lineHeight: type.displayLg,
    letterSpacing: -type.displayLg * 0.03,
    color: colors.ink,
  },
  detail: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
  },
  odds: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  oddsLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  oddsValue: { fontFamily: fonts.medium, fontSize: type.body },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
