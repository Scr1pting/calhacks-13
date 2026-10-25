import { Animated, Platform, StyleSheet } from 'react-native'
import { BlurView } from 'expo-blur'
import { colors } from '../theme/tokens'

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView)

// Behind the chat: the page it was opened from, blurring as the chat comes in
// (`reveal` 0 → 1), like Apple's search and Spotlight. A light wash on top
// keeps the messages readable. Android only gets the wash (its blur needs the
// page wrapped in a BlurTargetView).
export default function ChatBackdrop({ reveal }) {
  return (
    <>
      {Platform.OS !== 'android' && (
        <AnimatedBlurView
          pointerEvents="none"
          tint="light"
          intensity={reveal.interpolate({ inputRange: [0, 1], outputRange: [0, 40] })}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.wash, { opacity: reveal }]}
      />
    </>
  )
}

const styles = StyleSheet.create({
  wash: {
    backgroundColor: Platform.OS === 'android' ? colors.screenBg : 'rgba(245, 245, 243, 0.72)',
  },
})
