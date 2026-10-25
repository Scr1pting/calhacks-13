import { View } from 'react-native'
import { colors } from '../theme/tokens'

// 1px hairline divider used inside cards.
export default function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.divider }} />
}
