import { Pressable, StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import EyebrowLabel from '../components/EyebrowLabel'
import Divider from '../components/Divider'
import StatusPill from '../components/StatusPill'
import { ChevronIcon } from '../components/icons'
import { colors, fonts, radii, type } from '../theme/tokens'

// Screen 7c: "Chat as home" — the app's home screen, where the Ask Leeway
// input bar is the main surface. Widgets above it show the next ride and the
// calendar appointments that still need one. Sending a message (typed, mic,
// or a chip) opens the normal chat thread; see useLeewayFlow's `openChat`.
export default function ChatHomeScreen({ chatHome }) {
  return (
    <>
      <Headline lead="Good morning, Denise.">What can I help with?</Headline>

      {!!chatHome.nextRide && (
        <Pressable accessibilityRole="button" onPress={chatHome.nextRide.onClick}>
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
                  <Pressable accessibilityRole="button" style={styles.bookButton} onPress={item.onAction}>
                    <Text style={styles.bookLabel}>{item.actionLabel}</Text>
                  </Pressable>
                )}
              </View>
            ))}
            <Divider />
            <Pressable accessibilityRole="button" style={styles.seeAll} onPress={chatHome.comingUp.onSeeAll}>
              <Text style={styles.seeAllLabel}>See all appointments</Text>
              {ChevronIcon}
            </Pressable>
          </View>
        </Card>
      )}

      <View style={styles.suggestions}>
        {chatHome.suggestions.map((s) => (
          <Pressable key={s.text} accessibilityRole="button" style={styles.chip} onPress={s.onClick}>
            <Text style={styles.chipLabel}>{s.text}</Text>
          </Pressable>
        ))}
      </View>
    </>
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
  // Pushed to the bottom of the screen, just above the Ask Leeway bar.
  suggestions: { marginTop: 'auto', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radii.buttonSm,
    borderWidth: 1,
    borderColor: colors.borderSecondary,
    justifyContent: 'center',
  },
  chipLabel: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.ink },
})
