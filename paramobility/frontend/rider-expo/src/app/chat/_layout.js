import { Platform } from 'react-native'
import { Stack } from 'expo-router'
import { colors } from '../../theme/tokens'

// The chat's own stack: the chat opens as a modal over the app (see
// ../_layout), and a stack of its own gives that modal a native header, with
// the close button (ChatPage). Transparent, so the page behind shows through
// the chat's blur.
export default function ChatLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: Platform.OS === 'ios',
        headerTransparent: true,
        headerShadowVisible: false,
        title: '',
        headerTintColor: colors.ink,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    />
  )
}
