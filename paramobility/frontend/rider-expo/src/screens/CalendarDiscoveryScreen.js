import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import SelectRow from '../components/SelectRow'
import Button from '../components/Button'
import NotNowButton from '../components/NotNowButton'
import { colors, fonts, type } from '../theme/tokens'

// Screen 1: "Calendar discovery".
export default function CalendarDiscoveryScreen({ discover }) {
  return (
    <>
      <Headline lead="Let's plan ahead.">
        I found a few upcoming appointments in your calendar. Would you like
        me to arrange transportation?
      </Headline>

      <View accessibilityLabel="Appointments that may need a ride" style={styles.list}>
        {discover.items.map((item) => (
          <SelectRow key={item.key} as="checkbox" selected={item.selected} onPress={item.onToggle}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.sub}>{item.when}</Text>
            <Text style={styles.sub}>{item.location}</Text>
          </SelectRow>
        ))}
      </View>

      <Text style={styles.note}>
        I skipped {discover.skipped} events that don't look like they need a ride, like work
        meetings and calls.
      </Text>

      <Button variant="primary" disabled={discover.arrangeDisabled} onPress={discover.onArrange}>
        {discover.arrangeLabel}
      </Button>
      <NotNowButton onPress={discover.onNotNow} />
    </>
  )
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  title: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  note: {
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.textSecondary,
    paddingHorizontal: 4,
  },
})
