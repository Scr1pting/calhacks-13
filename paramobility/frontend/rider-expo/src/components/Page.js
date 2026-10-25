import { useContext, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { HeaderHeightContext } from 'expo-router/react-navigation'
import Svg, { Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useFlow } from '../state/FlowContext'
import { useShell } from './ShellContext'
import { colors, fonts, type } from '../theme/tokens'
import TopBar, { TOP_BAR_HEIGHT } from './TopBar'
import AskBar from './AskBar'
import Headline from './Headline'

import CalendarDiscoveryScreen from '../screens/CalendarDiscoveryScreen'
import RecommendedBookingScreen from '../screens/RecommendedBookingScreen'
import BookingProgressScreen from '../screens/BookingProgressScreen'
import HomeScreen from '../screens/HomeScreen'
import EmptyHomeScreen from '../screens/EmptyHomeScreen'
import EverydayHomeScreen from '../screens/EverydayHomeScreen'
import CallingClinicScreen from '../screens/CallingClinicScreen'
import OutcomeScreen from '../screens/OutcomeScreen'
import RiderDecisionScreen from '../screens/RiderDecisionScreen'
import ChatScreen from '../screens/ChatScreen'
import ChatHomeScreen, { ChatHomeSuggestions } from '../screens/ChatHomeScreen'
import LiveTripScreen from '../screens/LiveTripScreen'

// On iOS the native stack header is the top bar: transparent, so pages
// scroll under it, with native buttons, which iOS 26 draws in Liquid Glass.
// Android and web get TopBar, a frosted bar pages scroll under.
const NATIVE_HEADER = Platform.OS === 'ios'

// Each page's screen, given the flow's view object for it.
const SCREENS = {
  discover: (v) => <CalendarDiscoveryScreen discover={v} />,
  recommend: (v) => <RecommendedBookingScreen recommend={v} />,
  working: (v) => <BookingProgressScreen working={v} />,
  home: (v) => (v.ride ? <LiveTripScreen ride={v.ride} /> : <HomeScreen home={v.home} />),
  ride: (v) => <LiveTripScreen ride={v} />,
  empty: (v) => <EmptyHomeScreen empty={v} />,
  everyday: (v) => <EverydayHomeScreen everyday={v} />,
  call: (v) => <CallingClinicScreen call={v} />,
  outcome: (v) => <OutcomeScreen outcome={v} />,
  decision: (v) => <RiderDecisionScreen decision={v} />,
  chat: (v) => <ChatScreen chat={v} />,
  chatHome: (v) => <ChatHomeScreen chatHome={v} />,
}

const viewOf = (name, flow) =>
  name === 'home' ? (flow.ride ? { ride: flow.ride } : flow.home && { home: flow.home }) : flow[name]

// No Ask Leeway bar on pages whose only action is a forced next step.
const NO_BAR = ['recommend', 'decision', 'working']

// One page of the navigation stack: top bar, the screen, the Ask Leeway bar.
export default function Page({ name }) {
  const flow = useFlow()
  const { openMenu, framed, frameTop } = useShell()
  const insets = useSafeAreaInsets()
  const scrollRef = useRef(null)

  // The flow only computes the view for the page on top. A page further down
  // the stack keeps showing what it last showed, so it's still there when a
  // swipe back uncovers it.
  const lastView = useRef(null)
  const view = viewOf(name, flow)
  if (view) lastView.current = view
  const shown = flow.route === name ? view : view || lastView.current

  const isRoot = name === 'chatHome'
  const hasInput = name === 'chat' || name === 'chatHome'
  const hasBar = !NO_BAR.includes(name)
  const top = framed ? frameTop : insets.top
  // Where the page starts: below the native header on iOS (its height,
  // status bar included), below TopBar elsewhere. 26px more, as in the design.
  const headerHeight = useContext(HeaderHeightContext) ?? 0
  const contentTop = (NATIVE_HEADER ? headerHeight : top + TOP_BAR_HEIGHT) + 26
  const goBack = () => (router.canGoBack() ? router.back() : flow.onCloseChat())

  // The Ask Leeway bar floats over the page; the page scrolls under it, so
  // its content ends with room for the bar (measured).
  const [footerHeight, setFooterHeight] = useState(0)
  const bottomGap = framed ? 26 : Math.max(insets.bottom, 10)
  const keyboardLift = useKeyboardLift()
  // The bar rides 10px above the keyboard, rather than above the home indicator.
  const lift = Math.max(bottomGap - 10, 0)
  const footerShift = keyboardLift.interpolate({
    inputRange: [0, lift, lift + 1000],
    outputRange: [0, 0, -1000],
  })

  // In the chat, the newest message stays in view above the keyboard (iOS
  // makes room for it, see automaticallyAdjustKeyboardInsets below).
  useEffect(() => {
    if (name !== 'chat') return
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    )
    return () => sub.remove()
  }, [name])

  return (
    <View style={styles.page}>
      {NATIVE_HEADER && (
        <>
          {isRoot && (
            <Stack.Toolbar placement="left">
              <Stack.Toolbar.View hidesSharedBackground>
                <Logo />
              </Stack.Toolbar.View>
            </Stack.Toolbar>
          )}
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.View>
              <MenuButton onPress={openMenu} />
            </Stack.Toolbar.View>
          </Stack.Toolbar>
        </>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          // The chat fills the page so its thread can sit at the bottom.
          name === 'chat' && styles.fill,
          { paddingTop: contentTop, paddingBottom: (hasBar ? footerHeight : bottomGap) + 16 },
        ]}
        // The page pads itself for the header and the bar it scrolls under.
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTop - 26, bottom: hasBar ? footerHeight : bottomGap }}
        // iOS makes room for the keyboard natively, in step with it, and
        // scrolling puts the keyboard away (the bar slides down with it).
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        // The chat thread reads bottom up: keep the newest message in view.
        onContentSizeChange={() => name === 'chat' && scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {!!flow.error && (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>Something went wrong: {flow.error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={flow.onDismissError} hitSlop={8}>
              <Text style={styles.errorClose}>×</Text>
            </Pressable>
          </View>
        )}
        {shown && SCREENS[name] ? SCREENS[name](shown) : <Headline lead="One moment.">Getting your rides.</Headline>}
      </ScrollView>

      {!NATIVE_HEADER && (
        <TopBar variant={isRoot ? 'logo' : 'back'} onBack={goBack} onMenuPress={openMenu} top={top} />
      )}

      {hasBar && (
        <Animated.View
          pointerEvents="box-none"
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
          style={[styles.footer, { paddingBottom: bottomGap, transform: [{ translateY: footerShift }] }]}
        >
          {name === 'chatHome' && <ChatHomeSuggestions chatHome={flow.chatHome} />}
          {hasInput ? (
            <AskBar
              mode="input"
              value={flow.chat.draft}
              onChangeText={flow.chat.onDraftChange}
              onSubmit={flow.chat.onSend}
              onSend={flow.chat.onSend}
              voice={flow.voice}
            />
          ) : (
            <AskBar mode="button" onOpenChat={flow.onOpenChat} voice={flow.voice} />
          )}
        </Animated.View>
      )}
    </View>
  )
}

// How far the keyboard covers the screen, as an Animated value that moves with
// it. iOS announces the keyboard before it slides and says how long the slide
// takes, so the value runs on the native thread over that same time, with an
// easing close to the keyboard's own spring: the bar travels with the keyboard.
// Android resizes the app for the keyboard by itself, so it stays 0 there.
const KEYBOARD_EASING = Easing.bezier(0.38, 0.7, 0.125, 1)

function useKeyboardLift() {
  const lift = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const slide = (toValue, duration) =>
      Animated.timing(lift, { toValue, duration, easing: KEYBOARD_EASING, useNativeDriver: true }).start()
    const subs = [
      Keyboard.addListener('keyboardWillShow', (e) => slide(e.endCoordinates.height, e.duration)),
      Keyboard.addListener('keyboardWillHide', (e) => slide(0, e.duration)),
    ]
    return () => subs.forEach((s) => s.remove())
  }, [lift])
  return lift
}

// The design's menu icon (three 14px lines), in the native header's right
// slot; iOS 26 puts its glass around it. The system's line.3.horizontal
// symbol is drawn at a fixed size, larger than the design's.
function MenuButton({ onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Menu"
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.menuLine} />
      <View style={styles.menuLine} />
      <View style={styles.menuLine} />
    </Pressable>
  )
}

// The Leeway wave, in the native header's left slot on the root page.
function Logo() {
  return (
    <Svg width={30} height={30} viewBox="0 0 30 30" accessibilityLabel="Leeway">
      <Path
        d="M3 18 C8 9 12 9 15 15 C18 21 22 21 27 12"
        fill="none"
        stroke={colors.ink}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.screenBg,
  },
  content: {
    paddingHorizontal: 24,
    gap: 16,
  },
  fill: {
    flexGrow: 1,
  },
  menuButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  menuLine: {
    width: 14,
    height: 1.8,
    backgroundColor: colors.ink,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    gap: 16,
  },
  error: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.errorBg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: type.secondary,
    lineHeight: type.secondary * 1.4,
    color: colors.errorText,
  },
  errorClose: {
    fontSize: 20,
    lineHeight: 20,
    color: colors.errorText,
  },
})
