import { useContext, useRef, useState } from 'react'
import { Animated, Platform, StyleSheet, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { HeaderHeightContext } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useFlow } from '../state/FlowContext'
import { useShell } from './ShellContext'
import TopBar, { TOP_BAR_HEIGHT } from './TopBar'
import AskBar from './AskBar'
import ChatBackdrop from './ChatBackdrop'
import ErrorBanner from './ErrorBanner'
import ChatScreen from '../screens/ChatScreen'

// On iOS the chat's top bar is its native header, with a native close button
// (Liquid Glass on iOS 26); Android and web get TopBar's.
const NATIVE_HEADER = Platform.OS === 'ios'

// The chat with Leeway: a modal over the app (src/app/chat), the page behind
// it blurred, with its own text field at the bottom. Closing it goes back to
// that page.
export default function ChatPage() {
  const flow = useFlow()
  const { framed, frameTop, bottomGap, keyboardShift } = useShell()
  const insets = useSafeAreaInsets()
  const top = framed ? frameTop : insets.top
  const headerHeight = useContext(HeaderHeightContext) ?? 0
  const contentTop = (NATIVE_HEADER ? headerHeight : top + TOP_BAR_HEIGHT) + 26
  const close = () => router.back()

  // Typing right away, unless a message (a tapped suggestion) is already on its way.
  const [autoFocus] = useState(!flow.chat.typing)
  const [barHeight, setBarHeight] = useState(0)

  // The thread opens already at the newest message; after that, new messages
  // scroll into view.
  const scrollRef = useRef(null)
  const scrolledToEnd = useRef(false)
  const onContentSizeChange = () => {
    scrollRef.current?.scrollToEnd({ animated: scrolledToEnd.current })
    scrolledToEnd.current = true
  }

  return (
    <View style={styles.page}>
      {NATIVE_HEADER && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close chat" onPress={close} />
        </Stack.Toolbar>
      )}
      <ChatBackdrop />

      <Animated.ScrollView
        ref={scrollRef}
        // The thread rises with the keyboard, like the field, so the newest
        // message stays right above it.
        style={[styles.page, { transform: [{ translateY: keyboardShift }] }]}
        contentContainerStyle={[styles.content, styles.fill, { paddingTop: contentTop, paddingBottom: barHeight + 16 }]}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTop - 26, bottom: barHeight }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={onContentSizeChange}
      >
        <ErrorBanner error={flow.error} onDismiss={flow.onDismissError} />
        <ChatScreen chat={flow.chat} />
      </Animated.ScrollView>

      {!NATIVE_HEADER && <TopBar variant="close" onBack={close} top={top} bare />}

      <Animated.View
        onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
        style={[styles.bar, { paddingBottom: bottomGap, transform: [{ translateY: keyboardShift }] }]}
      >
        <AskBar
          mode="input"
          value={flow.chat.draft}
          onChangeText={flow.chat.onDraftChange}
          onSubmit={flow.chat.onSend}
          onSend={flow.chat.onSend}
          voice={flow.voice}
          autoFocus={autoFocus}
        />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    gap: 16,
  },
  // A thread fills the page so it can sit at the bottom.
  fill: {
    flexGrow: 1,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
  },
})
