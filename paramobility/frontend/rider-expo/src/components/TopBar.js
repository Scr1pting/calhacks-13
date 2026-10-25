import { Platform, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { colors, hitMin } from '../theme/tokens'

// The bar's height below the status bar: its 4px top padding and the 44px buttons.
export const TOP_BAR_HEIGHT = 4 + hitMin

// Leeway wave logo (or a back button, on pages above the root) on the left;
// menu button on the right, which opens the demo menu. Used on Android and
// web (iOS uses the native header, see Page). It floats over the page, which
// scrolls under it: frosted in the browser, translucent on Android.
// `top` is the status bar height above it.
export default function TopBar({ variant = 'logo', onBack, onMenuPress, top = 0 }) {
  return (
    <View style={[styles.bar, { paddingTop: top + 4 }]}>
      {variant === 'back' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [styles.circleButton, styles.backButton, pressed && styles.pressed]}
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
        style={({ pressed }) => [styles.circleButton, pressed && styles.pressed]}
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 26,
    paddingRight: 20,
    paddingBottom: 6,
    ...Platform.select({
      web: { backgroundColor: 'rgba(245, 245, 243, 0.72)', backdropFilter: 'saturate(180%) blur(20px)' },
      default: { backgroundColor: 'rgba(245, 245, 243, 0.94)' },
    }),
  },
  // The back button's circle lines up with the content, not the logo.
  backButton: {
    marginLeft: -6,
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
  pressed: {
    opacity: 0.6,
  },
  menuLine: {
    width: 14,
    height: 1.8,
    backgroundColor: colors.ink,
  },
})
