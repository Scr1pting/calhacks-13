import { StyleSheet, Text, View } from 'react-native'
import Svg, { Polygon } from 'react-native-svg'
import Card from './Card'
import { colors, fonts, radii, type } from '../theme/tokens'

// Appointment name + address with a decorative map thumbnail, recreated
// from the design's CSS shapes (two "roads", a green patch, a pin) — the
// design system has no raster map assets.
export default function LocationCard({ name, address }) {
  return (
    <Card size="small" style={styles.card}>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Svg width={18} height={18} viewBox="0 0 14 14">
            <Polygon points="1,1 13,6 7.5,7.5 6,13" fill={colors.ink} />
          </Svg>
          <Text style={styles.name}>{name}</Text>
        </View>
        <Text style={styles.address}>{address}</Text>
      </View>
      <View style={styles.mapThumb} accessible accessibilityLabel={`Map showing ${name}`}>
        <View style={styles.road1} />
        <View style={styles.road2} />
        <View style={styles.patch} />
        <View style={styles.pin} />
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  info: {
    flex: 1,
    gap: 5,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontFamily: fonts.medium,
    fontSize: type.body,
    color: colors.ink,
  },
  address: {
    fontFamily: fonts.regular,
    fontSize: type.caption,
    color: colors.textSecondary,
  },
  mapThumb: {
    width: 84,
    height: 58,
    borderRadius: radii.map,
    backgroundColor: colors.mapBg,
    overflow: 'hidden',
  },
  road1: {
    position: 'absolute',
    left: -10,
    top: 30,
    width: 120,
    height: 5,
    backgroundColor: colors.mapRoad,
    transform: [{ rotate: '-18deg' }],
  },
  road2: {
    position: 'absolute',
    left: 48,
    top: -10,
    width: 5,
    height: 90,
    backgroundColor: colors.mapRoad,
    transform: [{ rotate: '12deg' }],
  },
  patch: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 30,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.mapGreenPatch,
  },
  pin: {
    position: 'absolute',
    left: 34,
    top: 20,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.mapPin,
    // A ring outside the pin, as in the design (a border would shrink the pin).
    boxShadow: `0 0 0 3px ${colors.white}`,
  },
})
