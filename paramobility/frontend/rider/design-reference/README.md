# Handoff: Leeway — Denise's journey (mobile app)

## Overview
Leeway is a mobile assistant for people with disabilities who rely on paratransit (East Bay Paratransit, "EBP") to get to medical appointments in the Bay Area. It reads the rider's calendar, recommends and books EBP pickup windows, predicts the chance of arriving on time, and when a ride runs late it calls the clinic to reschedule. If the clinic can't accommodate, it asks the rider to choose. A chat ("Ask Leeway") lets the rider ask questions or request changes by text or voice.

The prototype follows one rider, Denise, through the full flow. All names, times, percentages and confirmation numbers are sample data.

## About the design files
`Leeway Denise Prototype.dc.html` is a **design reference built in HTML**. It is not production code. Recreate it in the target codebase's environment (React Native, SwiftUI, etc.) using that codebase's patterns. If no codebase exists yet, a cross-platform mobile stack (React Native / Expo) is a reasonable default.

To view it, open the file in a browser with `support.js` next to it. The phone on the left is live. The panel on the right jumps to any step and simulates events (delay notices, "It's Tuesday morning").

The template markup sits between `<x-dc>` and `</x-dc>`; `{{ name }}` holes are filled from `renderVals()` in the `<script data-dc-script>` class at the bottom. That class holds all state, sample data, copy and transitions, so read it as the behavior spec.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and copy are final. Recreate them closely.

## Global layout (phone, 390 × 844 reference)
- Screen background `#F5F5F3`. Font: **Instrument Sans** (400/500/600), text `#141618`.
- Status bar: 54px high, clock 16px/600, tabular numerals, 38px side padding.
- Top bar: Leeway wave logo (30×30 SVG, 4px stroke, round caps) on the left; 44×44 white circular menu button with three 14×1.8px lines on the right. Padding `4px 20px 0 26px`. In chat, the logo becomes a 44×44 white circular back button with a chevron.
- Content area: padding `26px 24px 16px`, vertical flex, `gap:16px`.
- Bottom "Ask Leeway" bar (on every screen except Recommended booking and Rider decision): margin `0 16px 26px`, min-height 60, radius 30, white, 1.5px border `#E6E5E2`, padding `6px 6px 6px 22px`. Placeholder 17px `#6B6E72`. 48×48 black circular mic button on the right. While the mic is held, the border and mic turn `#4A3BB8` and the text reads "Listening…". Tapping the text opens chat.

## Shared components
- **Headline**: 28px/400, line-height 1.2, letter-spacing −0.02em, `text-wrap: pretty`, 4px side padding. A dark lead sentence followed by a gray (`#6B6E72`) continuation in the same paragraph.
- **Card**: white, radius 28 (20 for small cards), padding 20, shadow `0 12px 30px -20px rgba(20,22,24,.18)`, internal gap 14.
- **Eyebrow label**: 13px/500, letter-spacing 0.08em, uppercase, `#6B6E72`.
- **Divider**: 1px `#EEEDEA`.
- **Key-value row**: space-between, baseline aligned. Label 15px `#6B6E72`; value 17–20px.
- **Big number**: 40–52px/400, letter-spacing −0.03em, line-height 1. Green `#1F6B4A` for on-time odds.
- **Primary button**: min-height 56, radius 28, `#141618` background, white 17px/500 text, centered.
- **Secondary button**: min-height 52 (44 compact), radius 26/22, 1px `#E1E0DC` border, transparent background, 17px/400 (15px compact).
- **Status pill**: min-height 28, padding `0 12px`, radius 14, 15px/400. Green: bg `#E3F1E8`, text `#1F6B4A` (Rescheduled, Recommended). Purple: bg `#ECE9FA`, text `#4A3BB8` (On a call, Listening in).
- **Selectable row** (checkbox / radio): white, radius 20, 1.5px border; white when unselected, `#141618` when selected. Checkbox is a 26px circle with a 2px border that fills black with a white ✓. Radio is a 24px ring with a 12px black dot.
- **Task list** (Leeway working): white card, radius 28, padding `6px 20px`. Rows min-height 60 with a 1px `#EEEDEA` divider between rows (none above the first or below the last). 24px status circle: gray ring `#C9C8C4` = pending, black ring = active, black fill with ✓ = done. Text 17px, `#6B6E72` while pending.
- **Location card**: white, radius 20, padding `14px 14px 14px 18px`. Name 17px/500 with a small arrow glyph, address 14px gray, 84×58 map thumbnail (radius 12) on the right.

## Screens
Numbers match the prototype's side panel.

1. **Calendar discovery**: headline "Let's plan ahead. I found a few upcoming appointments…". Checkbox rows (Neurology Tue Nov 3 10:30 AM; Physical therapy Thu Nov 5 2:00 PM; each at Kaiser Oakland). Gray note about 4 skipped events. Primary button "Arrange rides (n)", which turns gray `#B9B8B4` and reads "Select an appointment" when nothing is selected.
2. **Recommended booking**: eyebrow "APPOINTMENT 1 OF 2", headline "Here's what I'd book." Location card. Card with "RECOMMENDED PICKUP WINDOW", window at 40px, "Tuesday. Be ready at 9:15.", divider, "Chance of arriving by 10:30 AM · 86%" (green), rationale text. Primary "Confirm". No bottom bar.
2b. **Leeway books with EBP**: headline "Calling East Bay Paratransit." plus gray "Nothing is booked until they confirm. You can leave the app." Three tasks advance about every 2s: Connected to EBP reservations → Pickup window accepted → Confirmation #48213. When done the headline becomes "Booked for Tuesday." and a primary button appears ("Next: Physical therapy" or "Done").
3a. **Nothing to plan**: headline, "LAST TRIP" card (Physical therapy, Thu Nov 5, Arrived 1:41 PM, on time), secondary "Book a ride yourself".
3c. **Everyday home**: headline "Your rides are taken care of." Next-ride card (86% big, pickup window) and an "ALSO BOOKED" list with per-trip odds.
3. **Ride booked, future day**: "You're set for Tuesday." Card with "CHANCE OF ARRIVING BY 10:30 AM", 86% at 52px, "Based on similar trips over the last 3 months.", pickup window row. Location card, monitoring note, and an optional "needs a ride" row for the other appointment with a compact black "Plan" button.
3b. **Day of ride**: same layout, headline "Be ready downstairs at 9:15."
4. **Calling the clinic (clinic says yes)**: headline "You may be 15 minutes late. I'm calling Kaiser Oakland…". Card with purple status pill and call timer, the last two live transcript lines (speaker eyebrow purple for LEEWAY, gray for FRONT DESK; line text 17px), divider, "Waiting for: …" text, secondary "Listen in" / "Stop listening".
5. **Rescheduled**: "Kaiser moved you to 11:00 AM." Card with green "Rescheduled" pill, old time struck through (20px gray) next to the new time at 44px, detail text, odds row (91%). Location card. Compact buttons "View calendar" and "Hear the call".
4b. **Calling the clinic (clinic says no)**: same as 4 with the "no" transcript, which routes to 6.
6. **Rider decision**: "Kaiser can't see you late today." Three radio rows: "Move to Thursday, 9:00 AM" (green "Recommended" pill), "Look for an accessible ride now", "Keep today's ride", each with a gray sub-line. The primary button label follows the choice ("Confirm" / "Check accessible rides" / "Keep today's ride"). No bottom bar.
6b. **Leeway makes the change**: task list (Kaiser confirmed Thursday → EBP cancelled ride #48213), then goes to 6c automatically.
6c. **Moved to Thursday**: outcome layout, "Ride for Thursday · Not booked yet", and the button "Plan Thursday's ride" goes to 2.
7. **Ask Leeway, new chat**: back button in the top bar. Headline "What can I help with? Ask about your rides, appointments or bookings. You can type or hold the mic to talk." Three suggestion rows (white, radius 20, min-height 60, 17px, gray chevron).
7b. **Ask Leeway, conversation**: thread scrolls and stays anchored to the bottom. Rider messages are right-aligned black bubbles (max 80% wide, radius `22 22 6 22`, padding `12px 16px`, white 17px). Leeway replies are unboxed 17px text, optionally followed by a ride card (pickup window 32px, odds row) and action chips (first filled black, second outlined). Action chips appear only on the latest reply. While Leeway composes, "Leeway is checking…" shows in 15px gray. The bottom bar becomes a real text input; when it has text, the mic becomes a black send button (up arrow).

## Interactions and state
- `screen`: discover | recommend | working | home | empty | everyday | call | outcome | decision | chat.
- `phase`: increments every 1s and drives the working tasks, the call transcript (one line about every 2.5s, 10s total), and auto-advances (call → outcome/decision, Thursday change → outcome).
- `sel` (calendar selections), `queue` / `qi` (appointments being booked in order), `booked` (per appointment), `today` (day-of vs. future), `callPath` (yes/no), `listening`, `mic`, `outKind` (moved/thursday), `choice` (decision radio), `work` (book/thu/car).
- Chat: `msgs` (from me/lw plus a reply key), `draft`, `typing`, `back` (the screen to return to). Replies arrive after 900ms. In production, replace the keyword matching (cancel / attendant / next) with the real assistant backend; the canned replies are in `CHAT` in the script.
- Status clock is sample data: 6:41 on a future day, 8:52 on the day of the ride, 9:20+ during the call, 9:26 after.

## Design tokens
- Ink `#141618`; secondary text `#6B6E72`; screen `#F5F5F3`; card `#FFFFFF`; desk/backdrop `#EDECE6`.
- Borders `#E6E5E2` (bar), `#E1E0DC` (secondary buttons), dividers `#EEEDEA`, pending ring `#C9C8C4`, disabled button `#B9B8B4`, map thumbnail `#EDEDEB`.
- Success `#1F6B4A` on `#E3F1E8`; Leeway voice/active `#4A3BB8` on `#ECE9FA`; warning text `#8A5A00`.
- Radii: 12 (map), 14 (pill), 20 (rows, small cards), 22/26/28 (buttons), 28 (cards), 30 (bar), 52 (device).
- Type: 52/44/40/32 for display numbers; 28 for headlines; 17 for body and buttons; 15 for secondary; 13 for eyebrows. Weights 400/500 only, with 600 for the status-bar clock.
- Shadow: `0 12px 30px -20px rgba(20,22,24,.18)`.
- Minimum hit target: 44px.

## Accessibility
Every interactive element must be at least 44px. Use the roles noted in the source (checkbox, radio/radiogroup, button), `aria-live="polite"` on the task list, call transcript and chat thread, and labels on icon-only buttons (Menu, Back, Hold to talk, Send). Keep body text at 15px or larger.

## Assets
No raster assets. The logo, map thumbnail, and icons (mic, send, chevron, calendar, phone, location arrow) are inline SVG or CSS in the source; swap them for the codebase's icon set where appropriate. Font: Instrument Sans (Google Fonts).

## Files
- `Leeway Denise Prototype.dc.html`: the full interactive prototype (markup, styles, state and sample data).
- `support.js`: the runtime needed to open the prototype in a browser. It is not part of the design.
- `screenshots/`: one PNG per screen at 2x (780 × 1688), numbered in flow order from 01 Calendar discovery to 15 Ask Leeway conversation.
