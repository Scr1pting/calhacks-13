import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import StatusPill from '../components/StatusPill'
import Divider from '../components/Divider'
import LocationCard from '../components/LocationCard'
import Button from '../components/Button'
import CallTranscript from '../components/CallTranscript'
import { CalendarIcon, PhoneIcon } from '../components/icons'
import { colors, fonts, type } from '../theme/tokens'

// Screens 5 / 6c: "Outcome" of a call to the appointment: rescheduled, still
// on, or unclear (`outcome.pill`). "Hear the call" shows the call transcript.
export default function OutcomeScreen({ outcome }) {
  return (
    <>
      <Headline lead={outcome.headlineLead}>{outcome.headlineGray}</Headline>

      <Card>
        <StatusPill tone="green">{outcome.pill || 'Rescheduled'}</StatusPill>
        <View style={styles.times}>
          {!!outcome.was && <Text style={styles.was}>{outcome.was}</Text>}
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
        {outcome.transcript?.length > 0 && (
          <Button variant="compact-outline" icon={PhoneIcon} onPress={outcome.onToggleTranscript}>
            {outcome.showTranscript ? 'Hide the call' : 'Hear the call'}
          </Button>
        )}
      </View>

      {outcome.showTranscript && <CallTranscript lines={outcome.transcript} />}
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
  oddsLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary, flexShrink: 1 },
  oddsValue: { fontFamily: fonts.medium, fontSize: type.body },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
