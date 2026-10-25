# Leeway rider app — Expo / React Native

The same Leeway rider-app design and flow as [`../rider/`](../rider/) (the
web/Vite version), rebuilt with React Native so it runs on Expo Go, iOS, and
Android. The original design file lives at
[`../rider/design-reference/`](../rider/design-reference/) — both apps are
built from it.

`src/state/useLeewayFlow.js` and `src/data/leewayDemoData.js` are copied
verbatim from the web app: pure JS/React logic with no DOM dependency, so
both frontends share the exact same flow behavior and sample data. Only the
UI layer (components, screens) is React Native instead of HTML/CSS.

## Running it

```bash
cd paramobility/frontend/rider-expo
npm install
npx expo start
```

Then either:
- press `i` / `a` to open in an iOS/Android simulator (requires Xcode /
  Android Studio),
- scan the QR code with the **Expo Go** app on your phone, or
- press `w` to run it in a browser (useful for a quick check, not a
  substitute for testing on-device).

## Notes

- There's no device status bar mocked in here (unlike the earlier web
  prototype) — on a real phone or Expo Go, the OS shows its own.
- The design prototype's own "jump to any screen" review panel is here too,
  but adapted as a modal opened from the top-right menu button (there's no
  room for a side panel on a phone). Dev/review tool only — remove before
  shipping to riders.
- A couple of sample-data fields aren't in the backend's `Trip` schema yet;
  see the comments in `src/data/leewayDemoData.js`.
