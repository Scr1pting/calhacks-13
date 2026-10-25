import { StyleSheet, View } from 'react-native'
import { cardShadow, colors, radii } from '../theme/tokens'

// White, shadowed card — radius 28 by default, 20 ("small") for compact
// cards like the location card.
export default function Card({ size = 'default', style, children, ...rest }) {
  return (
    <View style={[styles.card, size === 'small' && styles.cardSmall, style]} {...rest}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.card,
    padding: 20,
    gap: 14,
    ...cardShadow,
  },
  cardSmall: {
    borderRadius: radii.cardSm,
  },
})
