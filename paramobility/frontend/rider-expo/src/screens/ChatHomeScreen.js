import { Pressable, StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import EyebrowLabel from '../components/EyebrowLabel'
import Divider from '../components/Divider'
import StatusPill from '../components/StatusPill'
import { ChevronIcon } from '../components/icons'
import Glass, { GLASS_AVAILABLE } from '../components/Glass'
import { colors, fonts, radii, type } from '../theme/tokens'

// Screen 7c: "Chat as home" — the app's home screen, where the Ask Leeway
// input bar is the main surface. Widgets above it show the next ride and the
// calendar appointments that still need one. Sending a message (typed, mic,
// or a chip) opens the normal chat thread; see useLeewayFlow's `openChat`.
// The suggestion chips sit just above that bar, outside the scrolling
// widgets: ChatHomeSuggestions, which Page renders there.
export default function ChatHomeScreen({ chatHome }) {
  return (
    <>
      <Headline lead="Good morning, Denise.">What can I help with?</Headline>

      {!!chatHome.nextRide && (
        <Pressable
          accessibilityRole="button"
          onPress={chatHome.nextRide.onClick}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Card>
            <View style={styles.nextHead}>
              <EyebrowLabel>NEXT RIDE · {chatHome.nextRide.dateCaps}</EyebrowLabel>
              {ChevronIcon}
            </View>
            <Text style={styles.nextWindow}>{chatHome.nextRide.window}</Text>
            <Text style={styles.nextTitle}>{chatHome.nextRide.title}</Text>
            <Divider />
            <View style={styles.nextOdds}>
              <Text style={styles.nextOddsLabel}>Chance of arriving by {chatHome.nextRide.time}</Text>
              <Text style={[styles.nextOddsValue, { color: chatHome.nextRide.oddsColor }]}>
                {chatHome.nextRide.oddsValue}
              </Text>
            </View>
          </Card>
        </Pressable>
      )}

      {!!chatHome.comingUp && (
        <Card>
          <EyebrowLabel>Coming up</EyebrowLabel>
          <View>
            {chatHome.comingUp.items.map((item, i) => (
              <View key={item.key} style={[styles.upcomingRow, i === 0 ? styles.upcomingRowFirst : styles.upcomingRowDivided]}>
                <View style={styles.upcomingInfo}>
                  <Text style={styles.upcomingTitle}>{item.title}</Text>
                  <Text style={styles.upcomingDate}>{item.date}</Text>
                </View>
                {item.status ? (
                  <View style={styles.pill}>
                    <StatusPill tone="green">{item.status}</StatusPill>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.bookButton, pressed && styles.pressed]}
                    onPress={item.onAction}
                  >
                    <Text style={styles.bookLabel}>{item.actionLabel}</Text>
                  </Pressable>
                )}
              </View>
            ))}
            <Divider />
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
              hitSlop={{ top: 12, bottom: 12 }}
              onPress={chatHome.comingUp.onSeeAll}
            >
              <Text style={styles.seeAllLabel}>See all appointments</Text>
              {ChevronIcon}
            </Pressable>
          </View>
        </Card>
      )}
    </>
  )
}

// Floating over the page like the bar below them: Liquid Glass capsules, or
// the design's outlined chips on a background of their own.
export function ChatHomeSuggestions({ chatHome }) {
  return (
    <View style={styles.suggestions}>
      {chatHome.suggestions.map((s) => (
        <Pressable key={s.text} accessibilityRole="button" onPress={s.onClick}>
          {({ pressed }) => (
            <Glass interactive style={[styles.chip, pressed && !GLASS_AVAILABLE && styles.pressed]} fallbackStyle={styles.chipSolid}>
              <Text style={styles.chipLabel}>{s.text}</Text>
            </Glass>
          )}
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  nextHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  nextWindow: {
    fontFamily: fonts.regular,
    fontSize: type.displaySm,
    lineHeight: type.displaySm,
    letterSpacing: -type.displaySm * 0.03,
    color: colors.ink,
  },
  nextTitle: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  nextOdds: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  nextOddsLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary, flexShrink: 1 },
  nextOddsValue: { fontFamily: fonts.medium, fontSize: type.body },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  // The card's own gap already spaces the first row from the eyebrow.
  upcomingRowFirst: { paddingTop: 0 },
  upcomingRowDivided: { borderTopWidth: 1, borderTopColor: colors.divider },
  upcomingInfo: { gap: 2, flexShrink: 1 },
  upcomingTitle: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  upcomingDate: { fontFamily: fonts.regular, fontSize: type.caption, color: colors.textSecondary },
  pill: { flexShrink: 0 },
  bookButton: {
    minHeight: 28,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.accentBg,
    justifyContent: 'center',
  },
  bookLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.accent },
  seeAll: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seeAllLabel: { fontFamily: fonts.regular, fontSize: type.body, color: colors.ink },
  // In line with the page content, which is 8px further in than the bar.
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radii.buttonSm,
    justifyContent: 'center',
  },
  chipSolid: {
    borderWidth: 1,
    borderColor: colors.borderSecondary,
    backgroundColor: colors.screenBg,
  },
  chipLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.ink },
  pressed: { opacity: 0.6 },
})
