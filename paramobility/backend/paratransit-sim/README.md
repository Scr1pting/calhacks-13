# East Bay Paratransit delay simulator

Generates realistic, labeled paratransit delay data for the East Bay (AC Transit / BART service area, Richmond to Fremont), plus a live replay feed and map. No real rider data is used; the simulator is **calibrated to East Bay Paratransit's (EBP) published performance**.

> Pitch line: "Trips are simulated. Delay behaviour is calibrated to East Bay Paratransit's published on-time performance. With the agency's real van GPS and stop data, the same pipeline runs on real trips."

## Quick start

```bash
pip install -r requirements.txt
python -m paratransit_sim run-all --days 14     # ~4 min: calibrate, generate 14 days, build replay
python -m paratransit_sim serve --speed 60      # http://localhost:8765  (1 sim minute per second)
```

Pre-generated output is already in `data/`, so you can skip straight to `serve`.

Other commands: `calibrate`, `generate --days N`, `replay --day N`, `serve --speed S --start MINUTES`.

## How it matches reality

| Metric | Simulator (14 days) | EBP, ops report Dec 2019 |
|---|---|---|
| On-time pickups (within 30-min window) | 88.0% | 87.9% year-to-date (standard: 91%) |
| Pickups more than 60 min late | 0.27% | 0.20% year-to-date |
| Rider no-shows | 2.2% | 2.6% rider-fault, year-to-date |
| Van minutes per passenger | 46.6 | 42.0 |
| Revenue miles per passenger | 6.6 | 9.8 |
| Weekday / weekend trips | 2,400 / 696 | ~2,600 / ~700 passengers incl. companions |

Only on-time performance is calibrated (by tuning schedule tightness). The other rows are independent checks. Known gaps: miles per passenger is low (our trips are a bit too local or shared too efficiently), and about 3% of trip requests get no van, whereas ADA paratransit must not deny trips. Add vans (`n_vans`) or widen `max_negotiation_min` to reduce that.

**Rules modeled from EBP's public policies:** 30-minute pickup window, rider ready when it opens; driver waits 5 minutes, then it's a no-show; booking up to 7 days ahead, with pickup times negotiated within an hour of the request.

**Assumptions** (all in `paratransit_sim/config.py`, labeled): fleet size and yards, hourly speeds and freeway boost, delay probabilities, boarding times by mobility type, rider purposes and mobility mix. Hospitals are real (approximate coordinates). Dialysis centers, senior centers, and stores are synthetic placeholders.

## How it works

1. **Riders** (`demand.py`): 7,000 synthetic riders across 18 East Bay areas with a purpose (dialysis on MWF/TTS, medical, senior programs, other), a usual destination, and mobility (ambulatory, walker, wheelchair). Each day generates outbound and return trips with appointment times.
2. **Scheduling** (`scheduler.py`): a greedy insertion scheduler, standing in for the agency's software, builds shared van routes. It promises each rider a 30-minute window, respects ride-time limits, appointment deadlines and shifts, and plans with slightly optimistic travel times.
3. **Execution** (`delays.py`): each route runs through a stochastic world: lognormal traffic noise by hour, incidents, hard-to-find addresses, riders not ready (leading to no-shows), boarding time, breakdowns, late shift starts. Lateness cascades from stop to stop.
4. **Calibration** (`calibrate.py`): bisection on schedule tightness (`plan_factor`) until on-time performance matches EBP's 87.9%.

## Output files (`data/`)

| File | Contents |
|---|---|
| `trips.csv` | One row per trip request: rider, purpose, origin/destination, requested and promised times, van, actual pickup and drop-off, minutes past window, ride time |
| `stops.csv` | One row per van stop: planned vs actual times **and the delay breakdown** (see below) |
| `riders.csv` | Synthetic rider pool |
| `replay.jsonl` | Time-ordered event stream for one day (see below) |
| `replay_meta.json` | Day info, map bounds, demo persona ("Maria"), day summary |
| `summary.json`, `calibration_report.json`, `calibrated_config.json` | Metrics, calibration history, parameters used |

Times are **minutes after midnight**. `day` 0 is a Monday.

### Delay columns in `stops.csv`

| Column | Meaning |
|---|---|
| `inherited_behind_min` | How far behind plan the van already was when it left the previous stop |
| `travel_planned_min` / `travel_actual_min` | Planned vs actual driving time for this leg (traffic) |
| `incident_min` | Extra minutes from a random incident on this leg |
| `hard_address_min` | Time spent finding the address |
| `rider_not_ready_min` | Waiting for the rider (5 = no-show) |
| `dwell_min` | Boarding or alighting time |
| `breakdown_min`, `late_start_min` | Vehicle breakdown, late departure from the yard |
| `idle_wait_min` | Van arrived early and waited for the window to open |
| `late_past_window`, `on_time` | Outcome for pickups |

**Finding worth pitching:** in the simulation, 96% of late pickups came from vans that were already 15+ minutes behind plan before leaving the previous stop. Lateness is mostly inherited, so it is visible well before the van arrives.

## Live feed (`serve`)

- `GET /`: map viewer. Vans are colored by how far behind plan they are; the side panel tracks the demo rider and lists late pickups with causes.
- `GET /stream`: Server-Sent Events, one message per sim minute: `{"t": 556, "clock": "9:16", "events": [...]}`.
- `GET /meta`: replay metadata, including the demo persona and current sim time.
- `GET /trip?id=<trip_id>`: all events so far for one trip. Hook your voice agent here.

Event types in `replay.jsonl` and the stream:
- `van_pos`: every 2 min per van: `lat`, `lon`, `behind_plan`.
- `stop`: van reached a pickup (`P`) or drop-off (`D`): `status` (ok, no_show, +breakdown), `window`, `minutes_past_window`, `behind_plan`, `inherited_behind`, `causes`.

## Swapping in real data later

- Hourly speeds: pass a CSV with `hour,speed_mph,sigma` via `speed_profile_csv` (for example derived from AC Transit real-time bus data via 511.org).
- Real destinations: replace `DESTINATIONS` in `geo.py` with OpenStreetMap points.
- Real trips: `stops.csv` mirrors what an agency's scheduling system records (planned vs actual stop times per vehicle), so a real export can replace it.

## Sources

- [East Bay Paratransit: General Rules and Policies](https://eastbayparatransit.org/general-rules-and-policies/)
- [East Bay Paratransit Operations Report, December 2019](https://eastbayparatransit.org/CMS/uploadedFiles/opsReportDec2019.pdf)
