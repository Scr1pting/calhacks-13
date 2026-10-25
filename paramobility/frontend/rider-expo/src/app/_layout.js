import { useEffect, useState } from 'react'
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import {
  useFonts,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from '@expo-google-fonts/instrument-sans'

import { FlowProvider, useFlow } from '../state/FlowContext'
import { useNavSync } from '../state/useNavSync'
import { ShellContext } from '../components/ShellContext'
import DemoMenu from '../components/DemoMenu'
import DemoPanel from '../components/DemoPanel'
import BottomBar, { useKeyboardShift } from '../components/BottomBar'
import { colors } from '../theme/tokens'

SplashScreen.preventAutoHideAsync()

// A browser at least this wide shows the app in a phone frame with the demo
// panel beside it, like the web app (../rider); narrower ones and phones
// show the app full screen, with the demo panel behind the menu button.
const DESK_MIN_WIDTH = 820
const FRAME_STATUS_BAR = 54

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  })

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <FlowProvider>
        <Shell />
      </FlowProvider>
    </SafeAreaProvider>
  )
}

function Shell() {
  const flow = useFlow()
  useNavSync(flow)
  const [menuOpen, setMenuOpen] = useState(false)
  const { width } = useWindowDimensions()
  const framed = Platform.OS === 'web' && width >= DESK_MIN_WIDTH
  const insets = useSafeAreaInsets()
  // Space below the Ask Leeway bar: the home indicator, or the frame's.
  const bottomGap = framed ? 26 : Math.max(insets.bottom, 10)
  const keyboardShift = useKeyboardShift(bottomGap)
  const [footerHeight, setFooterHeight] = useState(0)
  const shell = {
    openMenu: () => setMenuOpen(true),
    framed,
    frameTop: framed ? FRAME_STATUS_BAR : 0,
    footerHeight,
    bottomGap,
    keyboardShift,
  }

  // Every page is a src/app route rendering Page, pushed and popped by
  // useNavSync. On iOS the native header is the top bar, transparent so pages
  // scroll under it (see Page); elsewhere Page draws its own.
  const stack = (
    <Stack
      screenOptions={{
        headerShown: Platform.OS === 'ios',
        headerTransparent: true,
        headerShadowVisible: false,
        title: '',
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.ink,
        contentStyle: { backgroundColor: colors.screenBg },
      }}
    >
      {/* The chat opens over the page it's opened from, which blurs behind
          it, fading in like Apple's search (see ChatPage). */}
      <Stack.Screen
        name="chat"
        options={{
          presentation: 'transparentModal',
          animation: 'fade',
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </Stack>
  )
  // Over the stack, not in each page, so it stays still as pages slide.
  const bar = <BottomBar shift={keyboardShift} bottomGap={bottomGap} onHeight={setFooterHeight} />
  const menu = <DemoMenu visible={menuOpen} onClose={() => setMenuOpen(false)} demo={flow.demo} />

  if (framed) {
    return (
      <ShellContext.Provider value={shell}>
        <ScrollView style={styles.desk} contentContainerStyle={styles.deskContent}>
          <View style={styles.frame}>
            {stack}
            {bar}
            <View style={styles.homeIndicator} pointerEvents="none" />
          </View>
          <View style={styles.sidePanel}>
            <DemoPanel demo={flow.demo} />
          </View>
        </ScrollView>
        {menu}
      </ShellContext.Provider>
    )
  }

  return (
    <ShellContext.Provider value={shell}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        {stack}
        {bar}
      </View>
      {menu}
    </ShellContext.Provider>
  )
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
  },
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
