import { Platform, StyleSheet, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { colors } from '../theme/tokens'

// Behind the chat: the page it was opened from, blurred, with a light wash so
// the messages stay readable. The modal's own fade brings it in, like Apple's
// search. Android only gets the wash (its blur needs the page wrapped in a
// BlurTargetView).
export default function ChatBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Platform.OS !== 'android' && <BlurView tint="light" intensity={40} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
    </View>
  )
}

const styles = StyleSheet.create({
  wash: {
    backgroundColor: Platform.OS === 'android' ? colors.screenBg : 'rgba(245, 245, 243, 0.72)',
  },
})
