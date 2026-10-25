import { useCallback, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import {
  useFonts,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from '@expo-google-fonts/instrument-sans'

import { useLeewayFlow } from './src/state/useLeewayFlow'
import { colors, fonts, type } from './src/theme/tokens'
import TopBar from './src/components/TopBar'
import AskBar from './src/components/AskBar'
import DemoMenu from './src/components/DemoMenu'
import DemoPanel from './src/components/DemoPanel'
import Headline from './src/components/Headline'

import CalendarDiscoveryScreen from './src/screens/CalendarDiscoveryScreen'
import RecommendedBookingScreen from './src/screens/RecommendedBookingScreen'
import BookingProgressScreen from './src/screens/BookingProgressScreen'
import HomeScreen from './src/screens/HomeScreen'
import EmptyHomeScreen from './src/screens/EmptyHomeScreen'
import EverydayHomeScreen from './src/screens/EverydayHomeScreen'
import CallingClinicScreen from './src/screens/CallingClinicScreen'
import OutcomeScreen from './src/screens/OutcomeScreen'
import RiderDecisionScreen from './src/screens/RiderDecisionScreen'
import ChatScreen from './src/screens/ChatScreen'
import ChatHomeScreen from './src/screens/ChatHomeScreen'
import LiveTripScreen from './src/screens/LiveTripScreen'

SplashScreen.preventAutoHideAsync()

// A browser at least this wide shows the app in a phone frame with the demo
// panel beside it, like the web app (../rider); narrower ones and phones
// show the app full screen, with the demo panel behind the menu button.
const DESK_MIN_WIDTH = 820

function renderScreen(flow) {
  switch (flow.screen) {
    case 'discover':
      return <CalendarDiscoveryScreen discover={flow.discover} />
    case 'recommend':
      return <RecommendedBookingScreen recommend={flow.recommend} />
    case 'working':
      return <BookingProgressScreen working={flow.working} />
    case 'home':
      return flow.ride ? <LiveTripScreen ride={flow.ride} /> : <HomeScreen home={flow.home} />
    case 'ride':
      return <LiveTripScreen ride={flow.ride} />
    case 'empty':
      return <EmptyHomeScreen empty={flow.empty} />
    case 'everyday':
      return <EverydayHomeScreen everyday={flow.everyday} />
    case 'call':
      return <CallingClinicScreen call={flow.call} />
    case 'outcome':
      return <OutcomeScreen outcome={flow.outcome} />
    case 'decision':
      return <RiderDecisionScreen decision={flow.decision} />
    case 'chat':
      return <ChatScreen chat={flow.chat} />
    case 'chatHome':
      return <ChatHomeScreen chatHome={flow.chatHome} />
    case 'loading':
      return <Headline lead="One moment.">Getting your rides.</Headline>
    default:
      return null
  }
}

// Everything inside the phone: top bar, the screen, the Ask Leeway bar.
function Phone({ flow, onMenuPress, framed }) {
  const isChat = flow.screen === 'chat'
  const hasInput = isChat || flow.screen === 'chatHome'

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar variant={flow.topBar} onBack={flow.onCloseChat} onMenuPress={onMenuPress} />

      {!!flow.error && (
        <View style={styles.error} accessibilityRole="alert">
          <Text style={styles.errorText}>Something went wrong: {flow.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={flow.onDismissError} hitSlop={8}>
            <Text style={styles.errorClose}>×</Text>
          </Pressable>
        </View>
      )}

      {isChat ? (
        <View style={styles.chatContent}>{renderScreen(flow)}</View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {renderScreen(flow)}
        </ScrollView>
      )}

      {flow.showBar && (
        <View style={[styles.bottomBar, framed && styles.bottomBarFramed]}>
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
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

export default function App() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  })
  const flow = useLeewayFlow()
  const [menuOpen, setMenuOpen] = useState(false)
  const { width } = useWindowDimensions()
  const desk = Platform.OS === 'web' && width >= DESK_MIN_WIDTH

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  const menu = (
    <DemoMenu visible={menuOpen} onClose={() => setMenuOpen(false)} demo={flow.demo} />
  )

  if (desk) {
    return (
      <SafeAreaProvider>
        <ScrollView style={styles.desk} contentContainerStyle={styles.deskContent} onLayout={onLayoutRootView}>
          <View style={styles.frame}>
            <View style={styles.frameStatusBar} />
            <Phone flow={flow} onMenuPress={() => setMenuOpen(true)} framed />
            <View style={styles.homeIndicator} />
          </View>
          <View style={styles.sidePanel}>
            <DemoPanel demo={flow.demo} />
          </View>
        </ScrollView>
        {menu}
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} onLayout={onLayoutRootView}>
        <StatusBar style="dark" />
        <Phone flow={flow} onMenuPress={() => setMenuOpen(true)} />
        {menu}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.screenBg,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 16,
  },
  chatContent: {
    flex: 1,
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 16,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  // Clears the frame's home indicator.
  bottomBarFramed: {
    paddingBottom: 26,
  },
  error: {
    marginHorizontal: 24,
    marginTop: 10,
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

  // ---- wide browser: phone frame and demo panel, as in the web app ----------
  desk: {
    flex: 1,
    backgroundColor: colors.backdrop,
  },
  deskContent: {
    flexGrow: 1,
    padding: 48,
    gap: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  frame: {
    width: 390,
    height: 844,
    borderRadius: 52,
    backgroundColor: colors.screenBg,
    borderWidth: 1,
    borderColor: '#DEDCD7',
    overflow: 'hidden',
    boxShadow: '0 40px 80px -40px rgba(35, 38, 42, 0.35)',
  },
  frameStatusBar: {
    height: 54,
  },
  homeIndicator: {
    position: 'absolute',
    left: 128,
    bottom: 8,
    width: 134,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.ink,
  },
  sidePanel: {
    width: 340,
    paddingTop: 8,
  },
})
