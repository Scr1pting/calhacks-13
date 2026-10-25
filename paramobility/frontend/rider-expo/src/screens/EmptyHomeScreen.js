import { StyleSheet, Text, View } from 'react-native'
import Headline from '../components/Headline'
import Card from '../components/Card'
import EyebrowLabel from '../components/EyebrowLabel'
import KeyValueRow from '../components/KeyValueRow'
import Button from '../components/Button'
import { colors, fonts, type } from '../theme/tokens'

// Screen 3a: "Nothing to plan".
export default function EmptyHomeScreen({ empty }) {
  return (
    <>
      <Headline lead="Nothing to plan right now.">
        No appointments in your calendar need a ride in the next two weeks.
        I'll let you know when one does.
      </Headline>

      {empty.lastTrip && (
      <Card>
        <EyebrowLabel>Last trip</EyebrowLabel>
        <View style={styles.row}>
          <Text style={styles.title}>{empty.lastTrip.title}</Text>
          <Text style={styles.date}>{empty.lastTrip.date}</Text>
        </View>
        <KeyValueRow
          label="Arrived"
          value={<Text style={styles.arrived}>{empty.lastTrip.arrivedText}</Text>}
        />
      </Card>
      )}

      <Button variant="secondary" onPress={empty.onRestart}>
        Book a ride yourself
      </Button>
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  title: { fontFamily: fonts.medium, fontSize: type.body, color: colors.ink },
  date: { fontFamily: fonts.regular, fontSize: type.secondary, color: colors.textSecondary },
  arrived: { fontFamily: fonts.regular, fontSize: type.body, color: colors.success },
})
