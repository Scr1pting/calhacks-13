import { createContext, useContext } from 'react'

// What the app around the pages provides: opening the demo menu, and on a
// wide browser the phone frame (`framed`), whose fake status bar is
// `frameTop` tall. src/app/_layout.js sets it.
export const ShellContext = createContext({ openMenu: () => {}, framed: false, frameTop: 0 })

export const useShell = () => useContext(ShellContext)
