import { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, Keyboard, Platform, StyleSheet } from 'react-native'
import { useFlow } from '../state/FlowContext'
import AskBar from './AskBar'

// No Ask Leeway bar on pages that end in their own decision (their buttons
// sit at the bottom instead, see ActionBar), nor over the chat, which has its
// own text field (ChatPage).
export const NO_BAR = ['discover', 'recommend', 'decision', 'working', 'chat']
export const hasBar = (route) => !NO_BAR.includes(route)

const HIDE_MS = 250

// The Ask Leeway bar, once for the whole app, floating over the navigation
// stack like a tab bar: it stays put while pages slide underneath, and slides
// away on the pages without it. Tapping it opens the chat; holding its mic
// talks to Leeway. src/app/_layout.js renders it; pages leave room for it
// (`footerHeight`, from onHeight).
//
// `shift` moves it with the keyboard (useKeyboardShift); `bottomGap` is the
// space under it (home indicator, or the phone frame's).
export default function BottomBar({ shift, bottomGap, onHeight }) {
  const flow = useFlow()
  const shown = hasBar(flow.route)

  const visible = useRef(new Animated.Value(shown ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(visible, {
      toValue: shown ? 1 : 0,
      duration: HIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [shown, visible])
  const hiddenOffset = visible.interpolate({ inputRange: [0, 1], outputRange: [120, 0] })

  return (
    <Animated.View
      pointerEvents={shown ? 'box-none' : 'none'}
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[
        styles.bar,
        { paddingBottom: bottomGap, opacity: visible, transform: [{ translateY: Animated.add(shift, hiddenOffset) }] },
      ]}
    >
      <AskBar mode="button" onOpenChat={flow.onOpenChat} voice={flow.voice} />
    </Animated.View>
  )
}

// How far to move what floats at the bottom so it rides 10px above the
// keyboard, as an Animated value that moves with it. iOS announces the
// keyboard before it slides and says how long the slide takes, so the value
// runs on the native thread over that same time, with an easing close to the
// keyboard's own spring. Android resizes the app for the keyboard by itself,
// so it stays 0 there.
const KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1)

export function useKeyboardShift(bottomGap) {
  const keyboard = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const slide = (toValue, duration) =>
      Animated.timing(keyboard, { toValue, duration, easing: KEYBOARD_EASING, useNativeDriver: true }).start()
    const subs = [
      Keyboard.addListener('keyboardWillShow', (e) => slide(e.endCoordinates.height, e.duration)),
      Keyboard.addListener('keyboardWillHide', (e) => slide(0, e.duration)),
    ]
    return () => subs.forEach((s) => s.remove())
  }, [keyboard])
  // Not above the home indicator any more, but 10px above the keyboard.
  const covered = Math.max(bottomGap - 10, 0)
  return useMemo(
    () => keyboard.interpolate({ inputRange: [0, covered, covered + 1000], outputRange: [0, 0, -1000] }),
    [keyboard, covered],
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
  },
})
