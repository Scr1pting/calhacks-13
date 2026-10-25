import { Pressable, StyleSheet, Text, TextInput } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import { colors, fonts, radii, type } from '../theme/tokens'
import { press } from '../lib/haptics'
import Glass from './Glass'

// The bottom bar, floating over the page in Liquid Glass (a white bar where
// there's no glass). In `mode="button"` it's a button that opens chat. In
// `mode="input"` (the chat page) it becomes a real text field, and
// the mic becomes a send button once there's a draft.
//
// The mic is tap-to-talk: tap to start, speak, tap again to stop. `voice.state`
// is idle | listening | thinking | speaking.
const STATUS = {
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Leeway is speaking…',
}

export default function AskBar({
  mode = 'button',
  onOpenChat,
  value = '',
  onChangeText,
  onSubmit,
  onSend,
  voice = { state: 'idle' },
  autoFocus = false,
}) {
  const listening = voice.state === 'listening'
  const status = STATUS[voice.state]
  const hasDraft = mode === 'input' && value.trim().length > 0 && !status

  return (
    <Glass
      interactive
      tintColor={listening ? colors.accentBg : undefined}
      style={styles.bar}
      fallbackStyle={[styles.barSolid, listening && { borderColor: colors.accent }]}
    >
      {mode === 'input' && !status ? (
        <TextInput
          accessibilityLabel="Message Leeway"
          placeholder="Ask Leeway"
          placeholderTextColor={colors.textSecondary}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          autoFocus={autoFocus}
          returnKeyType="send"
          style={styles.input}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          onPress={onOpenChat}
          style={styles.textButton}
        >
          <Text style={styles.text}>{status || 'Ask Leeway'}</Text>
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
          accessibilityLabel={listening ? 'Stop talking to Leeway' : 'Talk to Leeway'}
          accessibilityState={{ selected: listening, disabled: voice.state === 'thinking' }}
          disabled={voice.state === 'thinking'}
          onPress={() => {
            press()
            if (listening) voice.onHoldEnd?.()
            else voice.onHoldStart?.()
          }}
          style={[
            styles.micButton,
            listening && { backgroundColor: colors.accent },
            voice.state === 'thinking' && { opacity: 0.5 },
          ]}
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
    </Glass>
  )
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 60,
    borderRadius: radii.bar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 22,
    paddingVertical: 6,
    paddingRight: 6,
  },
  // Without glass: the design's white bar, lifted off the page it floats over.
  barSolid: {
    backgroundColor: colors.cardBg,
    borderWidth: 1.5,
    borderColor: colors.borderBar,
    boxShadow: '0 10px 30px -14px rgba(20, 22, 24, 0.22)',
  },
  textButton: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.textSecondary,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.regular,
    fontSize: type.body,
    color: colors.ink,
    padding: 0,
    outlineStyle: 'none',
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
})
