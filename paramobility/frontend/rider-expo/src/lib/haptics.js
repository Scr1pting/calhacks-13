import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

// Taps the phone gives back, as iOS apps do: a light one for buttons, a firmer
// one when the mic starts listening, and a success one when a ride is booked.
// Browsers have none.
const enabled = Platform.OS !== 'web'
const quietly = (promise) => promise.catch(() => {})

export const tap = () => enabled && quietly(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))
export const press = () => enabled && quietly(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium))
export const success = () =>
  enabled && quietly(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
