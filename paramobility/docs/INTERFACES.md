# Backend API

Base URL: `https://api.cal.fuzz.li`. Interactive docs: [`/docs`](https://api.cal.fuzz.li/docs).

Every request except `/health` needs the header `X-API-Key: <key>`. Ask the backend team for the key.

All times are ISO 8601 with a time zone, for example `2026-11-03T14:00:00-08:00`. The backend formats times in messages using the time zone of `arrive_by`.

## Trip lifecycle

```
POST /trips ──► planning ──► planned ──POST /book──► booked ──picked_up──► riding ──arrived──► completed
                   │            ▲
                   └─► failed ──┘ POST /plan (replan)
```

1. **Create a trip.** The planner agent starts at once. If the rider allows it, it may phone the appointment first to learn the grace period, which takes a few minutes. Poll `GET /trips/{id}` until `status` is `planned` or `failed`.
2. **Show the plan.** `plan.recommended` is the suggested pickup time. `plan.options` holds the best times for the rider's certainty, and `plan.tradeoff` scores every candidate time. All numbers come from the delay model, and `plan.explanation` deliberately contains none.
3. **Book.** The rider confirms a time from the plan.
4. **Ride.** Send live updates from the rider app. The backend re-checks the arrival outlook after each update and once a minute. If the rider becomes likely to be late, the late-notice agent phones the appointment, within the rider's permissions.
5. **Arrive.** The trip is logged so the delay model's estimates improve over time.

`GET /trips/{id}/events` returns the activity log (planning, calls, notices) to show the rider what the agent did.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/trips` | `TripRequest` | `Trip` (202, status `planning`) |
| `GET` | `/trips` | | `Trip[]`, newest first |
| `GET` | `/trips/{id}` | | `Trip` |
| `GET` | `/trips/{id}/events` | | `Event[]` |
| `POST` | `/trips/{id}/plan` | `{"certainty": 0.95}` (optional) | `Trip` (202); replans a `planned` or `failed` trip |
| `PUT` | `/trips/{id}/policy` | `AppointmentPolicy` | `Trip`; the rider already knows the late policy (replan afterwards) |
| `POST` | `/trips/{id}/book` | `{"pickup_time": "..."}` | `Trip`; the time must come from the plan |
| `POST` | `/trips/{id}/status` | `{"kind": "van_eta" \| "picked_up" \| "arrived", "at": "..."}` | `Trip`; `at` defaults to now. For `van_eta`, `at` is when the van is expected |
| `GET` | `/trips/{id}/distribution?pickup_time=...` | | arrival histogram and per-sample components, for the dashboard |
| `GET` | `/calibration` | | `[{"promised": 0.9, "observed": 0.87}, ...]` |
| `GET` | `/health` | | `{"ok": true}` |

## Shapes

```jsonc
// TripRequest
{
  "rider": {"name": "Maya"},       // "phone" optional, currently unused
  "appointment": {"name": "Eastside Clinic", "phone": "+14155550199"},
  "origin": "1200 Market St, San Francisco",
  "dest": "Eastside Clinic, Oakland",
  "arrive_by": "2026-11-03T14:00:00-08:00",
  "certainty": 0.9,                // 0.5 to 0.99
  "notes": "",                     // anything the agent should know
  "permissions": {                 // limits the rider sets; all optional
    "may_call_appointment": true,
    "share_rider_name": true,
    "max_calls": 3                 // calls to the appointment per trip
  }
}

// Trip: everything in TripRequest, plus
{
  "id": "trip_…",
  "status": "planning | planned | booked | riding | completed | failed",
  "error": "",                     // why planning failed, if it did
  "policy": {"grace_minutes": 10, "can_reschedule": true, "alternative_times": "", "notes": "", "source": "call | rider"},
  "plan": {
    "recommended": TripOption,
    "options": [TripOption],
    "tradeoff": [TripOption],
    "explanation": "…"
  },
  "booked_pickup": "…",
  "live": {"van_eta": null, "picked_up_at": null, "arrived_at": null},
  "outlook": {"checked_at": "…", "p_on_time": 0.42, "expected_arrival": "…", "minutes_late": 6},
  "late_notice": {"sent_at": "…", "minutes_late": 6},
  "calls_used": 1
}

// TripOption
{"pickup_time": "…", "p_on_time": 0.93, "expected_wait_minutes": 19.8}

// Event
{"id": "evt_…", "trip_id": "trip_…", "at": "…", "kind": "plan_ready", "message": "…", "data": {}}
```

Event kinds: `planning`, `plan_ready`, `planning_failed`, `policy_learned`, `policy_set`, `booked`, `van_eta`, `picked_up`, `arrived`, `running_late`, `late_handled`, `call_started`, `call_ended`, `call_failed`, `call_skipped`.
