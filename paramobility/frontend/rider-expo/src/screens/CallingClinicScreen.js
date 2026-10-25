import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import StatusPill from '../components/StatusPill'
import Divider from '../components/Divider'
import Button from '../components/Button'
import { colors, fonts, type } from '../theme/tokens'

// Screens 4 / 4b: "Calling the clinic". `call.onToggleListen` is optional:
// listening in needs live call audio the backend doesn't expose yet.
export default function CallingClinicScreen({ call }) {
  return (
    <>
      <Headline lead={call.headlineLead}>{call.headlineGray}</Headline>

      <Card accessibilityLiveRegion="polite">
        <View style={styles.statusRow}>
          <StatusPill tone="purple">{call.statusLabel}</StatusPill>
          <Text style={styles.time}>{call.callTime}</Text>
        </View>

        <View style={styles.transcript}>
          {call.lines.map((line, i) => (
            <View key={i} style={styles.line}>
              <Text
                style={[
                  styles.who,
                  { color: line.tone === 'accent' ? colors.accent : colors.textSecondary },
                ]}
              >
                {line.who}
              </Text>
              <Text style={styles.text}>{line.t}</Text>
            </View>
          ))}
        </View>

        <Divider />
        <Text style={styles.waiting}>{call.waitingFor}</Text>

        {call.onToggleListen && (
          <Button
            variant="secondary"
            background={call.listening ? colors.accentBg : undefined}
            onPress={call.onToggleListen}
          >
            {call.listenLabel}
          </Button>
        )}
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  transcript: { gap: 12 },
  line: { gap: 3 },
  who: { fontFamily: fonts.semiBold, fontSize: type.eyebrow, letterSpacing: type.eyebrow * 0.06 },
  text: { fontFamily: fonts.regular, fontSize: type.body, lineHeight: type.body * 1.35, color: colors.ink },
  waiting: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
  },
})
