# Hand-off: the presentation ride (dashboard ↔ phone)

Goal: the dashboard's first-person chase view of one simulated rider drives the phone. You see:
1. The chance of arriving on time falls while she waits.
2. It jumps when the van arrives.
3. It drops again at two extra pickups.
4. Below 50%, the phone asks "Call the appointment?", and **Yes** places the real late-notice call.

Status (2026-10-25): the **backend is done and tested**: 142 tests pass, 6 of them new in `tests/test_presentation.py`. The **phone and dashboard are not started**. **Nothing is committed.** Everything is in the working tree on `main`.

## Design: the dashboard only sends the clock
- The dashboard posts its sim time (minutes after midnight) to `POST /presentation/clock {t}`.
- The backend replays a pre-exported van track (`backend/app/demo/presentation_ride.json`, one point per 15 sim-seconds) through the existing live model (`app/prediction/live.py` + `onboard.py`) up to `t`.
- It mirrors the result onto a real booked `Trip`, so the phone's existing screens show it: home screen while waiting, ride screen when riding, call/outcome screens on `call_started`/`call_ended`.
- Going backwards in time replays from the start, and resets status, `late_ask`, `late_notice` and `calls_used`, so rehearsals don't use up the call budget.

### The chosen ride: sim trip D15T0852, van 71
Fruitvale → Alta Bates Summit (Berkeley), window 10:30–11:00. We picked the appointment time, **11:52**: day 15 isn't in `trips.csv`, so the data has no appointment time for it.

Verified replay (`uv run python -m app.demo.presentation` from `backend/`):
- 10:30–11:08 waiting: 95% → 45%
- 11:09 picked up: 85%
- 11:14 first extra pickup: dips to 60%, recovers to 85%
- 11:34 second extra pickup, with a detour: **40%, a single ASK**, "about 5 min late"
- 11:41 another rider is dropped off: 0%
- arrives about 11:56–11:58

Maria (the existing persona) doesn't fit this story. Her extra pickups happen *before* hers.

## Backend changes
- `app/demo/presentation.py` (new): `Ride` loader, `step()` (shared replay engine), `start()`, `advance()`, `_sync()` (live status → Trip outlook/status/progress/late_ask), `publish()`. Also the `check()` CLI.
  - The ask threshold is `ALERT_BELOW = 0.5`.
  - The current trip id is kept in store json `"presentation"`, so a restart rebuilds the run.
- `app/demo/presentation_ride.json` (new): generated, our own sim data only.
- `app/api/presentation.py` (new): `GET /presentation` (ride info + current `trip_id`, so the dashboard knows which van/time range to film), `POST /presentation/start {rider_id, appointment_phone}`, `POST /presentation/clock {t}` (409 if not started). Wired in `app/main.py`.
- `app/api/trips.py`: `POST /trips/{id}/late-ask {call: bool}`. Yes spawns `monitor.call_confirmed`. 409 if there's no ask or it's already answered.
- `app/agents/monitor.py`:
  - `check_trip` and `monitor_loop` skip trips with `Trip.demo` set (a persisted marker, so it survives restarts).
  - New `call_confirmed()` and `call_summary()` (posts the result as a chat notice).
- `app/core/schemas.py`: `Trip.demo`, `Trip.late_ask: LateAsk{asked_at, minutes_late, message, answer}`, `LiveStatus.progress`.
- `app/prediction/onboard.py` / `live.py`: per-trip `alert_below` (default still 0.7).
- `app/prediction/routing.py`: `replaying()` context. It forces demo-cache record/replay for its block and logs and returns cache misses. Google answers go to `DEMO_CACHE_PATH` (git-ignored, `/data` on the server), never into git, per the Maps caching terms.
- `app/core/bus.py`: `publish` is now thread-safe (uses `call_soon_threadsafe` to the subscriber's loop). Before, publishing from sync endpoints or worker threads could stall SSE until the 15 s keep-alive.
- `scripts/demo_ride.py` (new, dev only): exports the ride from `frontend/dashboard/public/data/fleet.json` and runs the check. Re-tune with `--trip/--appointment`.
- **Trip updates go out on the rider stream** as event `trips` (same as new trips). The phone must handle updates to existing trips (see below). Not yet documented in `docs/INTERFACES.md`.

## Still to do

### 1. Phone (`frontend/rider-expo/src`)
- `api/client.js`: add `startPresentation(riderId, phone)` → `POST /presentation/start`, and `answerLateAsk(id, call)` → `POST /trips/{id}/late-ask`.
- `state/useLeewayFlow.js`:
  - `onTrip` (~line 274) currently ignores trips it already has. Replace the existing trip when `trip.demo` is set.
  - `current` (~line 505): prefer the active trip with `demo`.
  - Navigate: on start, go to `home` (Day of ride; it shows `outlook.p_on_time` while waiting). On booked→riding, go to `ride`.
  - Ride screen (~line 835): use `current.live.progress` when set, instead of the `Date.now()` math. Sim-dated times make that clamp to 1. Show "Expected arrival" instead of the fake sample-route distance.
  - Add an `ask` to the ride view when `current.late_ask && !late_ask.answer`. Suggested copy: "You'll likely be about N minutes late. Should I call <appointment> to let them know?"
  - Add a demo-panel button, "Presentation ride", in the `simulate` list (~line 1403), that calls `startPresentation(riderId, callPhone)`.
  - Grep for `Date.now()` filters that could hide a trip whose times have already passed: lines ~503, 880, 1228.
- `components/Page.js`: add `ACTIONS.ride` and `ACTIONS.home` (when `v.ride?.ask`) rendering a new `RideActions`: a primary "Call <appointment>" button plus `NotNowButton`. The ride page shows the Ask bar (`BottomBar` `NO_BAR`). Check how the ActionBar and the bar coexist, or add `ride` to `NO_BAR` while asking.
- After **Yes**, the existing `call_started` (late_notice) handler already switches to the call screen, and `call_ended` switches to outcome/decision.

### 2. Dashboard (`frontend/dashboard/src`)
- Env vars `VITE_API_BASE` and `VITE_API_KEY`. On load, `GET /presentation` returns `sim_trip`, `start`, `end` and `pickup_t`.
- Follow that rider instead of Maria. `mariaTrip()` in `App.jsx` reads `fleet.meta.persona`; add a `?trip=` param or build the rider from the `/presentation` info.
- Add a presenter-mode film, e.g. `film/presentation.js` modeled on `film/script.js`, with shots: waiting → van arrives → pickup 2 → pickup 3 → ask. Keep ride shots at about 10–20× so uncached Google calls keep up.
- In the animation loop, while that film plays, post `s.t` to `/presentation/clock` about 4 times a second, with **one request in flight at a time** (each new post carries the latest `t`). Stepping back needs nothing special; the server replays.

### 3. Rehearsal on prod
Cartesia is only configured there; locally a Yes just logs `call_skipped`.
- Approve the stage phone in the demo panel (PIN).
- Run `python -m app.demo.presentation` once inside the api container to record Google's answers into `/data/demo_cache.json`. Run it again and confirm "0 live answers".
- Do a full run-through. Server-wide limits are 4 calls/hour and 12/day per number (`CALL_LIMIT_PER_HOUR/DAY`), and rehearsals count against them.
- Keep a recorded backup.

## Known caveats
- The planned drive (waiting-phase curve) comes from `routing.drive_minutes` for next Tuesday 10:45 (7-day drive cache), so it can shift slightly week to week.
- The alert's "about 5 min late" is the live model's smoothed number; the van actually arrives about 4–6 min late.
- The phone's map is still the sample Kaiser route (`lib/liveRoute.js`), illustrative only.
