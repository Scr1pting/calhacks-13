import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import EyebrowLabel from '../components/EyebrowLabel'
import Divider from '../components/Divider'
import LiveMap from '../components/LiveMap'
import { cardShadow, colors, fonts, radii, type } from '../theme/tokens'

// Screen 8: "Live trip" — shown once the van has picked the rider up.
// `ride.progress`/`heavyTraffic` position the sample GPS dot (see
// src/lib/liveRoute.js); the headline, odds, color and reason are the real
// backend outlook for this trip.
export default function LiveTripScreen({ ride }) {
  return (
    <>
      <Headline lead={ride.headlineLead}>{ride.headlineGray}</Headline>

      <View style={styles.map}>
        <LiveMap
          progress={ride.progress}
          heavyTraffic={ride.heavyTraffic}
          label={ride.mapLabel}
          dom={{ style: { flex: 1 }, scrollEnabled: false }}
        />
      </View>

      <Card>
        <View style={styles.main}>
          <EyebrowLabel>{ride.label}</EyebrowLabel>
          <View style={styles.bigRow}>
            <Text style={[styles.big, { color: ride.color }]}>{ride.big}</Text>
            <Text style={styles.delta}>{ride.delta}</Text>
          </View>
          <Text style={styles.reason} accessibilityLiveRegion="polite">
            {ride.reason}
          </Text>
        </View>
        <Divider />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{ride.rowLabel}</Text>
          <Text style={styles.rowValue}>{ride.rowValue}</Text>
        </View>
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  // Fills the space the card leaves, like the web app's map.
  map: {
    flexGrow: 1,
    minHeight: 180,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.mapBg,
    ...cardShadow,
  },
  main: { gap: 6 },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  big: {
    fontFamily: fonts.regular,
    fontSize: type.displayLg,
    lineHeight: type.displayLg,
    letterSpacing: -type.displayLg * 0.03,
  },
  delta: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  reason: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  rowLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary, flexShrink: 1 },
  rowValue: {
    flexShrink: 0,
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
})
