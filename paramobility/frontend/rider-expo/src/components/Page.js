import { useContext, useRef, useState } from 'react'
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native'
import { Stack, router } from 'expo-router'
import { HeaderHeightContext } from 'expo-router/react-navigation'
import Svg, { Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useFlow } from '../state/FlowContext'
import { useShell } from './ShellContext'
import { colors } from '../theme/tokens'
import TopBar, { TOP_BAR_HEIGHT } from './TopBar'
import Headline from './Headline'
import ErrorBanner from './ErrorBanner'
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
// over all pages). The chat is its own page (ChatPage).
export default function Page({ name }) {
  const flow = useFlow()
  const { openMenu, framed, frameTop, footerHeight, bottomGap, keyboardShift } = useShell()
  const insets = useSafeAreaInsets()

  // The flow only computes the view for the page on top. A page further down
  // the stack keeps showing what it last showed, so it's still there when a
  // swipe back uncovers it.
  const lastView = useRef(null)
  const view = viewOf(name, flow)
  if (view) lastView.current = view
  const shown = flow.route === name ? view : view || lastView.current

  const isRoot = name === 'chatHome'
  const hasBar = routeHasBar(name)
  const top = framed ? frameTop : insets.top
  // Where the page starts: below the native header on iOS (its height,
  // status bar included), below TopBar elsewhere. 26px more, as in the design.
  const headerHeight = useContext(HeaderHeightContext) ?? 0
  const contentTop = (NATIVE_HEADER ? headerHeight : top + TOP_BAR_HEIGHT) + 26
  const goBack = () => (router.canGoBack() ? router.back() : flow.onCloseChat())

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

      <Animated.ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: contentTop, paddingBottom: bottomCovered + 16 }]}
        // The page pads itself for the header and the bar it scrolls under.
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: contentTop - 26, bottom: bottomCovered }}
        // iOS makes room for the keyboard natively, in step with it, and
        // scrolling puts the keyboard away (the bar slides down with it).
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <ErrorBanner error={flow.error} onDismiss={flow.onDismissError} />
        {shown && SCREENS[name] ? SCREENS[name](shown) : <Headline lead="One moment.">Getting your rides.</Headline>}
      </Animated.ScrollView>

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

      {!NATIVE_HEADER && (
        <TopBar variant={isRoot ? 'logo' : 'back'} onBack={goBack} onMenuPress={openMenu} top={top} />
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
})
