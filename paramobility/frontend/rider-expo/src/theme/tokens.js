// Design tokens transcribed from the web app's src/tokens.css, which in
// turn came from design-reference/README.md and the original .dc.html
// prototype. React Native has no CSS custom properties, so these are plain
// JS constants used directly in StyleSheet.create() calls.

export const colors = {
  ink: '#141618',
  textSecondary: '#6B6E72',
  screenBg: '#F5F5F3',
  cardBg: '#FFFFFF',
  backdrop: '#EDECE6',

  borderBar: '#E6E5E2',
  borderSecondary: '#E1E0DC',
  divider: '#EEEDEA',
  ringPending: '#C9C8C4',
  buttonDisabled: '#B9B8B4',
  mapBg: '#EDEDEB',
  mapRoad: '#FFFFFF',
  mapGreenPatch: '#DDE9DE',
  mapPin: '#2FA36B',

  success: '#1F6B4A',
  successBg: '#E3F1E8',
  accent: '#4A3BB8',
  accentBg: '#ECE9FA',

  white: '#FFFFFF',
}

export const radii = {
  map: 12,
  pill: 14,
  row: 20,
  cardSm: 20,
  card: 28,
  buttonSm: 22,
  button: 26,
  buttonLg: 28,
  bar: 30,
}

export const type = {
  displayXl: 52,
  displayLg: 44,
  displayMd: 40,
  displaySm: 32,
  headline: 28,
  body: 17,
  secondary: 15,
  caption: 14,
  eyebrow: 13,
}

// 'Instrument Sans' loaded via @expo-google-fonts/instrument-sans in
// App.js (useFonts). These keys match the font family names that package
// exports.
export const fonts = {
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semiBold: 'InstrumentSans_600SemiBold',
}

// RN has no box-shadow; this is the closest cross-platform approximation of
// the design's `0 12px 30px -20px rgba(20,22,24,.18)` card shadow.
export const cardShadow = {
  shadowColor: 'rgba(20,22,24,1)',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.18,
  shadowRadius: 10,
  elevation: 3,
}

export const hitMin = 44
