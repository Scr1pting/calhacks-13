# Hand-off: Paratransit Delay Predictor + Voice Agent (Cal Hacks 13.0)

## 1. One-liner
A voice-first assistant for East Bay Paratransit riders that (a) advises what drop-off time to request so they arrive on time, (b) predicts live how late their ride will be, (c) calls the paratransit hotline for an ETA when needed, and (d) texts their appointment if they'll be late.

## 2. Why (pitch facts)
- East Bay Paratransit (EBP, run by AC Transit + BART): 94.1% on-time in FY24–25 against a **30-min** pickup window (SF Access: 97.4% against a 20-min window) → EBP is several times worse like-for-like.
- EBP riders have **no live ETA**: the only way is to phone (510) 287-5000 *after* the window ends. The EBP app is payment-only; booking/cancelling are phone-only.
- EBP switched to Spare scheduling software on May 1, 2026; the driver app records times/GPS internally, but nothing is exposed to riders or developers.
- Paratransit riders who miss dialysis are ~3× more likely to need emergency care. ~5.8M Americans delay medical care yearly due to transportation.
- NYC Access-A-Ride: ~50k trips/weekday, ~6.5% picked up >20 min late → ~3,000 late trips/day.

## 3. Hard constraints
- **Never call real agency lines.** The hotline is a mock (see §6.4). Explain why in the pitch: identity verification, line load, recording consent (CA is two-party consent).
- **Never send messages/book/cancel without explicit user confirmation** in the UI or by voice.
- Agent must disclose it is an AI when calling the clinic.
- Privacy: store pickup locations only as H3 cell IDs; never store destination type (e.g., dialysis); delete raw GPS after trip end; show area stats only when ≥3 reports; opt-in per trip.
- Accessibility: whole flow usable by voice/phone; WCAG 2.2 AA for UI (screen-reader labels, large touch targets, high contrast, no color-only meaning).
- Synthetic data only. No real rider PII.

## 4. Demo script (target: 3 minutes)
1. Rider (voice): "I have dialysis at 2:00 Thursday." → app: "Request drop-off by 1:35; 90% chance on time." (Agent can book via mock hotline after confirmation.)
2. Day of: simulated day plays at 10×. Map shows hex delay layer + bus-slowdown layer.
3. Inject traffic jam in Oakland at 1:00 → buses slow → hexes turn red **before any rider reports**. Demo rider's P(on time) drops 85% → 40%.
4. Pickup window ends, no van → agent calls mock hotline, navigates IVR/hold/ID check, extracts "ETA 1:42, vehicle 4127."
5. Another simulated rider is already on van 4127 → ETA snaps to precise time.
6. Predicted 20 min late → agent asks rider to confirm, then texts clinic. Also tells rider: "You can decline this late ride with no penalty."

## 5. Architecture
```
frontend (React + deck.gl)  ←websocket→  backend (FastAPI, Python)
                                           ├─ sim/        synthetic East Bay day
                                           ├─ prior/      baseline lateness model
                                           ├─ estimator/  multi-output Tobit GP (Gibbs)
                                           ├─ predict/    per-rider P(on time), ETA
                                           ├─ ingest/     511.org bus feed (optional live)
                                           ├─ agent/      voice agent (Twilio + Cartesia + Claude)
                                           ├─ hotline/    mock EBP dispatcher (Twilio + Claude)
                                           └─ notify/     SMS to clinic (Twilio)
config/agencies.yaml   rules per agency (EBP primary; SF Access, NYC AAR secondary)
```
Stack: Python 3.11, FastAPI, NumPy/SciPy, `h3`, `scipy.stats.truncnorm`; React + deck.gl `H3HexagonLayer`; Twilio Voice/SMS; Cartesia TTS; Claude (Anthropic API); optional Convex for realtime state (sponsor).

Env vars: `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`, `CARTESIA_API_KEY`, `API_511_KEY` (optional), `GOOGLE_MAPS_KEY` (optional, drive times).

## 6. Components

### 6.1 Simulator (`sim/`) — build first, everything depends on it
- Box over East Bay (Richmond–Fremont). ~30 vans, ~200 riders, one day.
- Each van runs a shared route (chained pickups/drop-offs). Delays propagate along the van's run. **Do not generate data from the GP** (avoids circular evaluation).
- Ground-truth traffic field: rush-hour bump + injectable jam (center, radius, start, duration, severity).
- Riders: 30-min pickup window; lateness `L = pickup_time − window_start` (min).
- Synthetic buses on fixed lines, sensing the same traffic field (segment travel-time anomaly).
- Emits events: scheduled, still-waiting (censored), picked-up, onboard GPS, dropped-off, van number.
- Speed control (1×, 10×) and a "jam" button for the demo.

### 6.2 Prior (`prior/`)
- Work in log space: `y = log(L + c)`.
- Fit a shifted lognormal `P(L' ≤ x) = Φ((log(x+c) − μ)/s)` exactly to NYC AAR thresholds: 70% ≤ 5 min, 93.5% ≤ 20 min, ~96% ≤ 30 min (note: figures come from different MTA releases; flag in UI/pitch).
- Keep `s, c`; recalibrate `μ_EB` so `P(L_EB > 30) = 0.059` (EBP 94.1% within the 30-min window).
- Time-of-day: `μ0(t) = μ_EB + β·g(t)`, `g` = rush-hour shape (later: from 511 bus data), rescaled so the trip-weighted average still matches 94.1%.
- Validation: fit on 5/20-min thresholds with `c` fixed → predict the 30-min figure.

### 6.3 Estimator (`estimator/`) — multi-output Tobit GP, Gibbs sampling
- Grid: H3 resolution 7 cells × 15-min blocks.
- **Bus data must be binned** (mean slowdown per cell/block, noise `σ²/n_bin`) → keeps `n ≈ 2,000`. Never feed raw bus points.
- Outputs `a ∈ {bus, van}`. Kernel (LMC, two latent functions):
  `Cov[f_a(x,t), f_a'(x',t')] = B1[a,a']·k_Matern32(space; ℓ≈3 km)·k_Matern12(time; ℓ≈30 min) + B2[a,a']·k_RBF(space; ℓ≈15 km)·k_RBF(time; ℓ≈3 h)`
  - Latent 1 = traffic (bus + van load on it). Latent 2 = system strain (van only, ~0 bus loading).
  - `B_q = w_q w_qᵀ` (+ diagonal κ). Bus–van correlation ρ unknown → default 0.5, expose slider; sensitivity test ρ ∈ {0.2, 0.5, 0.8}.
  - Prior mean = `μ0(t)` for van, 0 for bus anomaly.
- Censoring (riders still waiting): lower bound `c_j = log(now − window_start + c)`.
- **Gibbs data augmentation** (exact posterior):
  1. `y_j ~ TruncNormal(f_j, σ², lower=c_j)` for each waiting rider.
  2. `f ~ GP posterior | full y` (Gaussian).
  - Noise is fixed → factor `K + N` (and posterior covariance) **once** per refit; each sweep is O(n²). ~300 sweeps, ~50 burn-in.
  - Warm-start from previous minute's samples; each minute increase `c_j` for still-waiting riders; on pickup, replace censored value with exact.
- Output per cell: posterior mean + 90% interval of lateness (back-transform from log space).
- Fallbacks if time runs short: (a) EM mean-imputation `E[y|y>c] = m + sλ(α)`, `λ(α)=φ(α)/(1−Φ(α))`, with noise inflated by `s²(1+αλ−λ²)`; (b) per-cell Kalman filter with neighbor smoothing.
- Hyperparameters set by hand (no paired data); optional offline fit of space/time lengthscales on 511 bus data via marginal likelihood.

### 6.4 Per-rider prediction (`predict/`)
- Combine: rider's own trip history (shrinkage `μ_trip = (n·L̄ + k·μ_prior)/(n+k)`, k≈5) + live cell estimate + prior.
- Live survival update while waiting: `P(pickup ≤ t1 | not by t0) = (F(t1) − F(t0)) / (1 − F(t0))`.
- Onboard: `t_arrive = now + drive(x_now, x_dest) + δ_shared` (drive time: Google Routes or straight-line × speed factor).
- Shared van: if another rider is onboard the same van number, use their position as the van location (never reveal it; only show ETA).
- Booking advice: `t_book = t_appt − q_0.9(L_total)`; user can choose risk level.
- Output: "68% chance you make your 2:00" (+ interval).

### 6.5 Voice agent (`agent/`)
- Twilio Voice + Cartesia TTS + Claude for dialog + speech-to-text (Twilio or Deepgram).
- Tasks: get ETA + vehicle number; book trip (requested drop-off time); cancel trip. Booking/cancel only after explicit rider confirmation.
- Must handle: IVR menu, hold music, identity questions (rider ID, name, address — synthetic), transfer, "we'll call you back", ETA that changes mid-call.
- Returns structured JSON: `{eta, vehicle_number, confidence, transcript}` → feeds estimator as an observation.
- Trigger: pickup window ended with no pickup, **or** live P(on time) < threshold (configurable). At most one call per trip per 15 min (protect hotline load).

### 6.6 Mock hotline (`hotline/`)
- Mimics EBP's line (510-287-5000): menu options, hold, ID verification, ETA lookup against simulator state, vehicle number, booking/cancel.
- Claude plays dispatcher; randomize personas and failure modes for testing.
- **Eval set:** 15–20 scripted scenarios; track ETA extraction success rate and wrong-statement rate.

### 6.7 Notifier (`notify/`)
- SMS (Twilio) to a pre-approved appointment contact using a template; rider confirms before send. Optional voice call with AI disclosure.

### 6.8 Frontend
- Map: H3 hex layer (van lateness), toggle bus-slowdown layer, van markers (sim only).
- Rider card: next trip, window, live P(on time), ETA, actions (call hotline, notify clinic, decline ride info).
- Voice-first: every action available by voice; screen-reader labels.
- Demo controls: speed, inject jam, ρ slider.

## 7. Agency rules (`config/agencies.yaml`)
| | EBP (primary) | SF Access | NYC AAR |
|---|---|---|---|
| Window | 30 min | −5/+15 min around promised time | 30 min policy (OTP metric: 20 min) |
| Driver wait | 5 min | — | 5 min |
| Booking | phone only, 8am–5pm, 1–7 days ahead; pickup **or** drop-off time | online/phone, 7am–6pm, 1–7 days | phone/app, 1–2 days, by 5pm |
| Late cancel | < 1 h before window | < 2 h | < 2 h |
| ETA | call 510-287-5000 after window ends | online map; "Where's My Ride" 415-285-6945 opt 3; 10-min imminent call | MY AAR app |
| Rider recourse | may decline late ride, no penalty | — | taxi authorization if ETA > 30 min late |
| Suspension | ≥6 no-shows/late cancels per quarter, up to 4 weeks | — | ≥30% & >7/month, 1–4 weeks |

## 8. Live data (optional, stretch)
- 511.org Open Data (free token): GTFS-RT Vehicle Positions (`agency=RG` regional, or AC Transit), Trip Updates, Service Alerts; Traffic Events (highways) and WZDx (closures, incl. planned).
- Default rate limit **60 requests/hour** → poll one feed per minute; request increase.
- Bus slowdown = segment travel-time anomaly between consecutive stops vs. typical for that hour (not schedule deviation). Exclude Tempo BRT (International Blvd, dedicated lanes).
- Planned closures (WZDx) can adjust booking advice days ahead.

## 9. Evaluation (`eval/`)
Compare on simulator ground truth: (1) ignore waiting riders, (2) lower-bound plug-in, (3) EM imputation, (4) Gibbs.
Metrics: RMSE inside/outside jam, 90% interval coverage, Brier score for P(on time), jam detection latency (min). Stress: adoption 1/5/20%, wrong lengthscales, ρ misspecified.

## 10. Priorities (36 h, team of 4)
| Priority | Item | Owner |
|---|---|---|
| Must | Simulator + jam injection | A |
| Must | Prior + Gibbs Tobit GP (single-output van first, then add bus output) | A |
| Must | Mock hotline + voice agent ETA call | B |
| Must | SMS notifier with confirmation | B |
| Must | Map + rider card + voice-first UI | C |
| Must | Demo script, pitch, backup recording | D |
| Nice | Multi-output with bus layer; shared-van ETA; booking via agent | A/B |
| Nice | Eval comparison table for the pitch | D |
| Stretch | Live 511 bus ingest; WZDx planned closures | C |
| Skip | Real agency calls; trained ML on real data | — |

Suggested order: sim → prior → single-output Gibbs GP → UI map → hotline + agent → notifier → bus output → shared van → eval.

## 11. Acceptance criteria
- Refit every simulated minute in < 1 s on a laptop (n ≈ 2,000).
- Jam visible on map before any rider is picked up late.
- Agent completes ETA call on ≥ 80% of mock scenarios; never books/cancels/sends without confirmation.
- 90% intervals cover truth 85–95% of the time in sim.
- Full demo runs end-to-end without network except Twilio/Claude/Cartesia; recorded backup exists (venue Wi-Fi was poor last year).

## 12. Open questions / unverified
- Does EBP's imminent-arrival call include the vehicle number? Does the dispatcher share it on request?
- Are EBP ETA inquiries answered outside 8am–5pm?
- EBP Spare Phase 2 rider app: not announced.
- NYC thresholds mix reporting periods; check data.ny.gov for a consistent dataset.
- Bus–van delay correlation ρ: no data; treat as assumption.

## 13. Sources
- EBP rules: https://eastbayparatransit.org/general-rules-and-policies/
- EBP app FAQ: https://www.eastbayparatransit.org/ebp-contactless-app.htm
- EBP Spare launch: https://www.eastbayparatransit.org/CMS/uploadedFiles/EBPxSPARE-SP-Communications.pdf
- EBP Spare FAQ: https://eastbayparatransit.org/sparelabsfaq/
- EBP committee packet (FY24–25 stats): https://www.eastbayparatransit.org/CMS/uploadedFiles/EBPACMeetingPacket11042025.pdf
- SF Access scheduling: https://www.sfmta.com/node/19120
- MTA AAR performance: https://www.mta.info/press-release/mta-access-ride-ridership-and-time-performance-skyrocket-wait-times-plummet
- 511 transit data: https://511.org/open-data/transit
- 511 traffic data: https://511.org/open-data/traffic
- Dialysis/paratransit: https://pmc.ncbi.nlm.nih.gov/articles/PMC8743465
- Transportation barriers to care: https://pmc.ncbi.nlm.nih.gov/articles/7204444
- Cal Hacks rules: https://www.calhacks.io
