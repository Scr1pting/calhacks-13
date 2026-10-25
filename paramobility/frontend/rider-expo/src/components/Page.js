import { useContext, useEffect, useRef, useState } from 'react'
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { HeaderHeightContext } from 'expo-router/react-navigation'
import Svg, { Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useFlow } from '../state/FlowContext'
import { useShell } from './ShellContext'
import { colors, fonts, type } from '../theme/tokens'
import TopBar, { TOP_BAR_HEIGHT } from './TopBar'
import Headline from './Headline'
import ChatBackdrop from './ChatBackdrop'
import { hasBar as routeHasBar } from './BottomBar'

import ActionBar from './ActionBar'
import CalendarDiscoveryScreen, { DiscoverActions } from '../screens/CalendarDiscoveryScreen'
import RecommendedBookingScreen, { RecommendActions } from '../screens/RecommendedBookingScreen'
import BookingProgressScreen, { WorkingActions } from '../screens/BookingProgressScreen'
import HomeScreen from '../screens/HomeScreen'
import EmptyHomeScreen from '../screens/EmptyHomeScreen'
import EverydayHomeScreen from '../screens/EverydayHomeScreen'
import CallingClinicScreen from '../screens/CallingClinicScreen'
import OutcomeScreen from '../screens/OutcomeScreen'
import RiderDecisionScreen, { DecisionActions } from '../screens/RiderDecisionScreen'
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

// The buttons of pages that end in a decision, fixed at the bottom.
const ACTIONS = {
  discover: (v) => <DiscoverActions discover={v} />,
  recommend: (v) => <RecommendActions recommend={v} />,
  working: (v) => v.done && <WorkingActions working={v} />,
  decision: (v) => <DecisionActions decision={v} />,
}

const viewOf = (name, flow) =>
  name === 'home' ? (flow.ride ? { ride: flow.ride } : flow.home && { home: flow.home }) : flow[name]

// One page of the navigation stack: its top bar and its screen, scrolling
// under the top bar and under the Ask Leeway bar (BottomBar, which floats
// over all pages).
export default function Page({ name }) {
  const flow = useFlow()
  const { openMenu, framed, frameTop, footerHeight, bottomGap, keyboardShift } = useShell()
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
  const isChat = name === 'chat'
  // A chat with messages reads bottom up, from the bar; an empty one shows its
  // headline and suggestions from the top.
  const isThread = isChat && !flow.chat.isEmpty
  const hasBar = routeHasBar(name)
  // The chat is an overlay without a native header (see _layout); it draws
  // its own close button.
  const nativeHeader = NATIVE_HEADER && !isChat
  const top = framed ? frameTop : insets.top
  // Where the page starts: below the native header on iOS (its height,
  // status bar included), below TopBar elsewhere. 26px more, as in the design.
  const headerHeight = useContext(HeaderHeightContext) ?? 0
  const contentTop = (nativeHeader ? headerHeight : top + TOP_BAR_HEIGHT) + 26
  const goBack = () => (router.canGoBack() ? router.back() : flow.onCloseChat())

  // The chat comes in like Apple's search: the page beneath blurs while the
  // chat fades and settles in (0 → 1), and goes back the same way on close.
  const reveal = useRef(new Animated.Value(isChat ? 0 : 1)).current
  const animateReveal = (toValue, done) =>
    Animated.timing(reveal, {
      toValue,
      duration: toValue ? 320 : 220,
      easing: Easing.out(Easing.cubic),
      // The blur's intensity can't run on the native driver.
      useNativeDriver: false,
    }).start(done)
  useEffect(() => {
    if (isChat) animateReveal(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // The chat is an overlay, not a page of the stack (see _layout): closing it
  // goes back to the page beneath it through the flow, not the router.
  const closeChat = () => animateReveal(0, flow.onCloseChat)
  useEffect(() => {
    if (!isChat) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeChat()
      return true
    })
    return () => sub.remove()
  })

  // The home page's suggestion chips float just above the bar, and belong to
  // the page (they slide away with it); measured to leave room for them too.
  const hasChips = name === 'chatHome'
  const [chipsHeight, setChipsHeight] = useState(0)
  // A decision page's own buttons, fixed at the bottom (ActionBar).
  const actions = shown && ACTIONS[name] ? ACTIONS[name](shown) : null
  const [actionsHeight, setActionsHeight] = useState(0)
  const bottomCovered = hasBar
    ? footerHeight + (hasChips ? chipsHeight : 0)
    : actions
      ? actionsHeight
      : bottomGap

  // The chat thread reads bottom up. It opens already at the newest message
  // (no visible scroll while the page fades in); after that, new messages
  // scroll into view.
  const scrolledToEnd = useRef(false)
  const onContentSizeChange = () => {
    if (!isThread) return
    scrollRef.current?.scrollToEnd({ animated: scrolledToEnd.current })
    scrolledToEnd.current = true
  }

  return (
    <View style={isChat ? styles.flex : styles.page}>
      {isChat && <ChatBackdrop reveal={reveal} />}
      {nativeHeader && (
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

      <Animated.View
        style={[
          styles.flex,
          isChat && {
            opacity: reveal,
            transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
          },
        ]}
      >
      <Animated.ScrollView
        ref={scrollRef}
        style={[
          styles.flex,
          // A chat thread rises with the keyboard, on the same animation as
          // the bar, so the newest message stays right above it. (Content
          // that starts at the top, like the empty chat, stays put.)
          isThread && { transform: [{ translateY: keyboardShift }] },
        ]}
        contentContainerStyle={[
          styles.content,
          // A chat thread fills the page so it can sit at the bottom.
          isThread && styles.fill,
          { paddingTop: contentTop, paddingBottom: bottomCovered + 16 },
        ]}
        // The page pads itself for the header and the bar it scrolls under.
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTop - 26, bottom: bottomCovered }}
        // Elsewhere iOS makes room for the keyboard natively, in step with it.
        // Scrolling puts the keyboard away (the bar slides down with it).
        automaticallyAdjustKeyboardInsets={!isThread}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={onContentSizeChange}
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
      </Animated.ScrollView>

      {!nativeHeader && (
        <TopBar
          variant={isRoot ? 'logo' : isChat ? 'close' : 'back'}
          onBack={isChat ? closeChat : goBack}
          onMenuPress={openMenu}
          top={top}
          bare={isChat}
        />
      )}
      </Animated.View>

      {actions && (
        <ActionBar bottomGap={bottomGap} onHeight={setActionsHeight}>
          {actions}
        </ActionBar>
      )}

      {hasChips && (
        <Animated.View
          pointerEvents="box-none"
          onLayout={(e) => setChipsHeight(e.nativeEvent.layout.height)}
          style={[styles.chips, { bottom: footerHeight, transform: [{ translateY: keyboardShift }] }]}
        >
          <ChatHomeSuggestions chatHome={flow.chatHome} />
        </Animated.View>
      )}
    </View>
  )
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
  flex: {
    flex: 1,
  },
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
  chips: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
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
