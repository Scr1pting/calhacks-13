import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import SelectRow from '../components/SelectRow'
import StatusPill from '../components/StatusPill'
import Button from '../components/Button'
import { colors, fonts, type } from '../theme/tokens'

// Screen 6: "Rider decision". No bottom bar on this screen.
export default function RiderDecisionScreen({ decision }) {
  return (
    <>
      <Headline lead={decision.headlineLead}>{decision.headlineGray}</Headline>

      <View accessibilityRole="radiogroup" style={styles.options}>
        {decision.options.map((option) => (
          <SelectRow key={option.key} as="radio" selected={option.selected} onPress={option.onSelect}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{option.title}</Text>
              {!!option.tag && <StatusPill tone="green">{option.tag}</StatusPill>}
            </View>
            <Text style={styles.sub}>{option.sub}</Text>
          </SelectRow>
        ))}
      </View>
    </>
  )
}

// Fixed at the bottom by Page.
export function DecisionActions({ decision }) {
  return (
    <Button variant="primary" onPress={decision.onApprove}>
      {decision.approveLabel}
    </Button>
  )
}

const styles = StyleSheet.create({
  options: { gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  sub: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
  },
})
