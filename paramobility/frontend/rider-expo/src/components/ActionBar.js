import { StyleSheet, View } from 'react-native'

// A page's own action buttons ("Confirm" / "Not now", "Arrange rides", ...),
// fixed at the bottom while the page scrolls under them, like iOS toolbars.
// The page's background fades in behind them so text scrolling underneath
// doesn't run into the buttons. Page renders it, and leaves room for it.
export default function ActionBar({ bottomGap, onHeight, children }) {
  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[styles.bar, { paddingBottom: bottomGap }]}
    >
      {children}
    </View>
  )
}

const FADE = 'linear-gradient(to bottom, rgba(245, 245, 243, 0), rgba(245, 245, 243, 0.94) 28px, #F5F5F3 56px)'

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 28,
    paddingHorizontal: 24,
    gap: 4,
    backgroundImage: FADE,
  },
})
