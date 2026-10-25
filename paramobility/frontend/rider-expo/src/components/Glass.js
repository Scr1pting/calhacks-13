import { Platform, View } from 'react-native'
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect'

// Liquid Glass where the phone has it (iOS 26+), for controls that float over
// the page: the Ask Leeway bar and the suggestion chips. Elsewhere (Android,
// web, older iOS) it's a plain view with `fallbackStyle`, which gives it a
// background of its own instead.
export const GLASS_AVAILABLE =
  Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable()

export default function Glass({ style, fallbackStyle, interactive = false, tintColor, children, ...rest }) {
  if (!GLASS_AVAILABLE) {
    return (
      <View style={[style, fallbackStyle]} {...rest}>
        {children}
      </View>
    )
  }
  return (
    <GlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tintColor} style={style} {...rest}>
      {children}
    </GlassView>
  )
}
