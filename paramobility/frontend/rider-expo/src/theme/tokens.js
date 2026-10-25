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

  success: '#1F6B4A', // on-time odds: 90%+
  successBg: '#E3F1E8',
  accent: '#4A3BB8',
  accentBg: '#ECE9FA',
  warningText: '#8A5A00',
  rideAmber: '#9A5B13', // on-time odds: 60-90%
  danger: '#A4342A', // on-time odds: under 60%
  errorBg: '#FBE9E7',
  errorText: '#8C2A1C',

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

// The design's card shadow, exactly as the web app has it (--lw-shadow-card).
// React Native's `boxShadow` (iOS, Android and web) takes the CSS value with
// its negative spread, which the older shadowOffset/shadowRadius props can't
// express: they draw a darker, tighter shadow.
export const cardShadow = {
  boxShadow: '0 12px 30px -20px rgba(20, 22, 24, 0.18)',
}

export const hitMin = 44
