# Leeway rider app — Expo / React Native

The Leeway rider app for iOS, Android and the browser, from one codebase. It
has every screen and feature of the web/Vite version in
[`../rider/`](../rider/): planning and booking rides on the live backend, the
live trip with its map, calls to the clinic, chat and talking to Leeway by
voice, and the demo panel. The design comes from
[`../rider/design-reference/`](../rider/design-reference/).

`src/state/useLeewayFlow.js` is the web app's hook, ported with only the
platform parts changed (saved state in AsyncStorage, the phone's calendar,
the recorder), so a diff against `../rider/src/state/useLeewayFlow.js` shows
exactly what differs. The screens are React Native versions of the web
screens, with the same design tokens (`src/theme/tokens.js`).

## Running it

```bash
cd paramobility/frontend/rider-expo
cp .env.example .env    # set EXPO_PUBLIC_API_KEY for the deployed backend
npm install
npx expo start
```

Then press `w` for the browser, `i` / `a` for an iOS/Android simulator, or
scan the QR code with Expo Go. A browser window wider than 820px shows the app
in a phone frame with the demo panel beside it; on a phone, the demo panel is
behind the menu button (top right).

Against a local backend (`uvicorn app.main:app --reload --host 0.0.0.0` in
`paramobility/backend`), set `EXPO_PUBLIC_API_BASE` to `http://localhost:8000`
for the browser or the iOS simulator, `http://10.0.2.2:8000` for the Android
emulator, or your computer's LAN address for a phone on the same Wi-Fi.
Restart `expo start` after changing `.env`.

## Platform notes

- **Navigation.** Expo Router's native stack (`src/app/`): pages push and pop
  like any iOS app, with the edge swipe back, Android back and browser back
  and URLs. The flow hook still decides which page to show;
  `src/state/useNavSync.js` turns that into pushes and pops, and reports a page
  the rider goes back to. On iOS the top bar is the native header,
  transparent with native buttons (Liquid Glass on iOS 26); on Android and
  web it's `TopBar`, frosted. The Ask Leeway bar floats over the page in
  Liquid Glass (`Glass`, a white bar where there's no glass) and moves with
  the keyboard.

- **Calendar.** On a phone with a development build, the app reads the phone's
  calendar (two weeks ahead) and the backend picks the entries that need a
  ride. On web, in Expo Go, or if the rider says no, it uses the mock calendar
  in `src/mocks/calendar.js`; the demo panel says which.
- **Live updates.** The backend's server-sent event streams are read with
  `fetch` (`src/api/client.js`), which streams on every platform; React Native
  has no `EventSource`.
- **Voice.** Hold the mic to talk. The phone records `.m4a` with expo-audio
  (`src/lib/recorder.js`); the browser records and converts to WAV
  (`src/lib/recorder.web.js`). The browser only allows the microphone on
  `localhost` or HTTPS.
- **Map.** `src/components/LiveMap.js` is an Expo DOM component: the same
  Leaflet/OpenStreetMap map as the web app, rendered in a webview on the phone.
- **Times** are shown in Bay Area time wherever the phone is
  (`src/lib/time.js`); the demo panel shows the current Bay Area time as a check.

## Development builds

The phone calendar needs a development build, not Expo Go. Build once in the
cloud with EAS (free Expo account) and install it from the link it prints:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android
```

Rebuild whenever native parts change (new native modules or `app.json`), then
day to day run `npx expo start --dev-client` and open the installed app
(`--tunnel` if the phone is on another network). iOS needs a paid Apple
Developer account for `--platform ios`, or a Mac with Xcode and
`npx expo run:ios --device`.

## Notes

- The demo panel (jump to any screen, simulate ride updates, set the number
  Leeway calls as the clinic) is a dev/review tool; remove it before shipping
  to riders.
- The East Bay Paratransit booking call is a mock (`src/mocks/paratransit.js`),
  as in the web app.
