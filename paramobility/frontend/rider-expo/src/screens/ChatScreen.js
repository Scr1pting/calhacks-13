import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import Headline from '../components/Headline'
import Button from '../components/Button'
import EyebrowLabel from '../components/EyebrowLabel'
import BigNumber from '../components/BigNumber'
import Divider from '../components/Divider'
import { cardShadow, colors, fonts, radii, type } from '../theme/tokens'

const ChevronIcon = (
  <Svg width={8} height={14} viewBox="0 0 8 14">
    <Path
      d="M1.5 1.5 L6.5 7 L1.5 12.5"
      fill="none"
      stroke={colors.textSecondary}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
)

// Screens 7 / 7b: "Ask Leeway".
export default function ChatScreen({ chat }) {
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [chat.messages.length, chat.typing])

  if (chat.isEmpty) {
    return (
      <>
        <Headline lead="What can I help with?">
          Ask about your rides, appointments or bookings. You can type or
          hold the mic to talk.
        </Headline>
        <View style={styles.suggestions}>
          {chat.suggestions.map((s) => (
            <Pressable key={s.text} style={styles.suggestion} onPress={s.onClick}>
              <Text style={styles.suggestionText}>{s.text}</Text>
              {ChevronIcon}
            </Pressable>
          ))}
        </View>
      </>
    )
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.thread}
      contentContainerStyle={styles.threadContent}
      accessibilityLiveRegion="polite"
    >
      {chat.messages.map((m, i) => (
        <View key={i}>
          {m.isMe ? (
            <View style={styles.bubbleMeWrap}>
              <Text style={styles.bubbleMe}>{m.text}</Text>
            </View>
          ) : (
            <View style={styles.agent}>
              <Text style={styles.agentText}>{m.text}</Text>
              {m.hasCard && (
                <View style={styles.card}>
                  <View style={styles.cardHead}>
                    <EyebrowLabel>{chat.rideCard.eyebrow}</EyebrowLabel>
                    <BigNumber size="sm">{chat.rideCard.window}</BigNumber>
                    <Text style={styles.cardSubtitle}>{chat.rideCard.subtitle}</Text>
                  </View>
                  <Divider />
                  <View style={styles.cardOdds}>
                    <Text style={styles.cardOddsLabel}>{chat.rideCard.oddsLabel}</Text>
                    <Text style={styles.cardOddsValue}>{chat.rideCard.oddsValue}</Text>
                  </View>
                </View>
              )}
              {m.hasActions && (
                <View style={styles.actions}>
                  {m.actions.map((a) => (
                    <Button key={a.label} variant={a.variant} onPress={a.onClick}>
                      {a.label}
                    </Button>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      ))}
      {chat.typing && <Text style={styles.typing}>{'Leeway is checking…'}</Text>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  suggestions: { gap: 10 },
  suggestion: {
    minHeight: 60,
    paddingHorizontal: 18,
    borderRadius: radii.row,
    backgroundColor: colors.cardBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    ...cardShadow,
  },
  suggestionText: { fontFamily: fonts.regular, fontSize: type.body, color: colors.ink, flexShrink: 1 },
  // Edge to edge, so the bubbles' shadows aren't clipped at the sides.
  thread: { flex: 1, marginHorizontal: -24 },
  threadContent: { gap: 18, paddingHorizontal: 24, paddingBottom: 4 },
  bubbleMeWrap: { alignItems: 'flex-end' },
  bubbleMe: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 6,
    backgroundColor: colors.ink,
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: type.body,
    lineHeight: type.body * 1.35,
    overflow: 'hidden',
  },
  agent: { gap: 12 },
  agentText: {
    alignSelf: 'flex-start',
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 22,
    backgroundColor: colors.cardBg,
    fontFamily: fonts.regular,
    fontSize: type.body,
    lineHeight: type.body * 1.4,
    color: colors.ink,
    overflow: 'hidden',
    ...cardShadow,
  },
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: 24,
    padding: 18,
    gap: 12,
    ...cardShadow,
  },
  cardHead: { gap: 6 },
  cardSubtitle: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  cardOdds: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  cardOddsLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  cardOddsValue: { fontFamily: fonts.medium, fontSize: type.body, color: colors.success },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typing: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary, paddingHorizontal: 4 },
})
