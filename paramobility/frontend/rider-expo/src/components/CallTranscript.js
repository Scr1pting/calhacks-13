import { StyleSheet, Text, View } from 'react-native'
import Card from './Card'
import { colors, fonts, type } from '../theme/tokens'

// A phone call's transcript, shown after the call ends (behind a "Hear the
// call" toggle) — used on the outcome screen and the EBP booking screen.
export default function CallTranscript({ lines }) {
  return (
    <Card>
      <View style={styles.transcript} accessibilityLabel="Call transcript">
        {lines.map((line, i) => (
          <View key={i}>
            <Text style={[styles.who, { color: line.who === 'LEEWAY' ? colors.accent : colors.textSecondary }]}>
              {line.who}
            </Text>
            <Text style={styles.text}>{line.t}</Text>
          </View>
        ))}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  transcript: { gap: 12 },
  who: {
    fontFamily: fonts.medium,
    fontSize: type.eyebrow,
    letterSpacing: type.eyebrow * 0.08,
    marginBottom: 2,
  },
  text: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.ink,
  },
})
