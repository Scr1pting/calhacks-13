import { useCallback, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
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
import { colors } from './src/theme/tokens'
import TopBar from './src/components/TopBar'
import AskBar from './src/components/AskBar'
import DemoMenu from './src/components/DemoMenu'

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

SplashScreen.preventAutoHideAsync()

function renderScreen(flow) {
  switch (flow.screen) {
    case 'discover':
      return <CalendarDiscoveryScreen discover={flow.discover} />
    case 'recommend':
      return <RecommendedBookingScreen recommend={flow.recommend} />
    case 'working':
      return <BookingProgressScreen working={flow.working} />
    case 'home':
      return <HomeScreen home={flow.home} />
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
    default:
      return null
  }
}

export default function App() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  })
  const flow = useLeewayFlow()
  const [menuOpen, setMenuOpen] = useState(false)

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  const isChat = flow.screen === 'chat'

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} onLayout={onLayoutRootView}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TopBar
            variant={flow.topBar}
            onBack={flow.onCloseChat}
            onMenuPress={() => setMenuOpen(true)}
          />

          {isChat ? (
            <View style={styles.chatContent}>{renderScreen(flow)}</View>
          ) : (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              {renderScreen(flow)}
            </ScrollView>
          )}

          {flow.showBar && (
            <View style={styles.bottomBar}>
              {isChat ? (
                <AskBar
                  mode="input"
                  value={flow.chat.draft}
                  onChangeText={flow.chat.onDraftChange}
                  onSubmit={flow.chat.onEnter}
                  onSend={flow.chat.onSend}
                />
              ) : (
                <AskBar mode="button" onOpenChat={flow.onOpenChat} />
              )}
            </View>
          )}
        </KeyboardAvoidingView>

        <DemoMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          stepGroups={flow.stepGroups}
          simulate={flow.simulate}
        />
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
    padding: 24,
    paddingTop: 10,
    gap: 16,
  },
  chatContent: {
    flex: 1,
    padding: 24,
    paddingTop: 10,
    gap: 16,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
})
