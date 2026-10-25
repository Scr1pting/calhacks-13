import { Pressable, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { colors, hitMin } from '../theme/tokens'

// Leeway wave logo (or a back button, in chat) on the left; menu button on
// the right, which opens the dev review menu (see DemoMenu).
export default function TopBar({ variant = 'logo', onBack, onMenuPress }) {
  return (
    <View style={styles.bar}>
      {variant === 'back' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.circleButton}
        >
          <Svg width={10} height={16} viewBox="0 0 10 16">
            <Path
              d="M8 2 L2 8 L8 14"
              fill="none"
              stroke={colors.ink}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      ) : (
        <Svg width={30} height={30} viewBox="0 0 30 30" accessibilityLabel="Leeway">
          <Path
            d="M3 18 C8 9 12 9 15 15 C18 21 22 21 27 12"
            fill="none"
            stroke={colors.ink}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Menu"
        onPress={onMenuPress}
        style={styles.circleButton}
      >
        <View style={styles.menuLine} />
        <View style={styles.menuLine} />
        <View style={styles.menuLine} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  circleButton: {
    width: hitMin,
    height: hitMin,
    borderRadius: hitMin / 2,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  menuLine: {
    width: 14,
    height: 1.8,
    backgroundColor: colors.ink,
  },
})
