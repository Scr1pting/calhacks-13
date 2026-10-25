import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import { colors, fonts, radii, type } from '../theme/tokens'

// The bottom bar. In `mode="button"` (every screen except chat) it's a
// button that opens chat, with a hold-to-talk mic. In `mode="input"` (the
// chat screen) it becomes a real text field, and the mic becomes a send
// button once there's a draft.
export default function AskBar({ mode = 'button', onOpenChat, value = '', onChangeText, onSubmit, onSend }) {
  const [listening, setListening] = useState(false)
  const hasDraft = mode === 'input' && value.trim().length > 0

  return (
    <View style={[styles.bar, listening && { borderColor: colors.accent }]}>
      {mode === 'input' ? (
        <TextInput
          accessibilityLabel="Message Leeway"
          placeholder="Ask Leeway"
          placeholderTextColor={colors.textSecondary}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          style={styles.input}
        />
      ) : (
        <Pressable accessibilityRole="button" onPress={onOpenChat} style={styles.textButton}>
          <Text style={styles.text}>{listening ? 'Listening…' : 'Ask Leeway'}</Text>
        </Pressable>
      )}

      {hasDraft ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={onSend} style={styles.micButton}>
          <Svg width={16} height={18} viewBox="0 0 16 18">
            <Path
              d="M8 16 V2 M2 8 L8 2 L14 8"
              fill="none"
              stroke={colors.white}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hold to talk"
          onPressIn={() => setListening(true)}
          onPressOut={() => setListening(false)}
          style={[styles.micButton, listening && { backgroundColor: colors.accent }]}
        >
          <Svg width={16} height={20} viewBox="0 0 16 20">
            <Rect x={5} y={1} width={6} height={11} rx={3} fill={colors.white} />
            <Path
              d="M2 9 A6 6 0 0 0 14 9 M8 15 V19"
              fill="none"
              stroke={colors.white}
              strokeWidth={1.8}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 60,
    borderRadius: radii.bar,
    backgroundColor: colors.cardBg,
    borderWidth: 1.5,
    borderColor: colors.borderBar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 22,
    paddingVertical: 6,
    paddingRight: 6,
  },
  textButton: {
    flex: 1,
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.textSecondary,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.ink,
    padding: 0,
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
