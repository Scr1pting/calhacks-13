import { createContext, useContext } from 'react'

import { Animated } from 'react-native'

// What the app around the pages provides (src/app/_layout.js sets it):
// - openMenu: opens the demo menu
// - framed / frameTop: on a wide browser, the phone frame, and how tall its
//   fake status bar is
// - footerHeight: how much the Ask Leeway bar covers at the bottom, so pages
//   can scroll their content clear of it; bottomGap, the space below it
// - keyboardShift: an Animated value that moves things at the bottom of the
//   screen with the keyboard (see BottomBar)
export const ShellContext = createContext({
  openMenu: () => {},
  framed: false,
  frameTop: 0,
  footerHeight: 0,
  bottomGap: 0,
  keyboardShift: new Animated.Value(0),
})

export const useShell = () => useContext(ShellContext)
