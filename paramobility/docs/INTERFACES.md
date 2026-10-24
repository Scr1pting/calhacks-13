# Backend API

Base URL: `https://api.cal.fuzz.li`. Interactive docs: [`/docs`](https://api.cal.fuzz.li/docs).

Every request except `/health` needs the header `X-API-Key: <key>`. Ask the backend team for the key. Browsers' `EventSource` can't send headers, so `GET /trips/{id}/stream` also accepts `?api_key=<key>`.

All times are ISO 8601 with a time zone, for example `2026-11-03T14:00:00-08:00`. The backend formats times in messages using the time zone of `arrive_by`.

## Trip lifecycle

```
POST /trips ──► planning ──► planned ──book──► booked ──picked_up──► riding ──arrived──► completed
                   │            ▲
                   └─► failed ──┘ replan
```

1. **Create a trip.** The planner agent starts at once. If the rider allows it, it may phone the appointment first to learn the grace period, which takes a few minutes. When the plan is ready, it appears on the trip and as a notice in the chat thread.
2. **Show the plan.** `plan.recommended` is the suggested pickup time. `plan.options` holds the best times for the rider's certainty, and `plan.tradeoff` scores every candidate time. All probabilities and wait times come from the delay model.
3. **Book.** The rider confirms a time from the plan, with a button or by telling the chat agent.
4. **Ride.** Send live updates from the rider app. The backend re-checks the arrival outlook after each update and once a minute. If the rider becomes likely to be late, the late-notice agent phones the appointment, within the rider's permissions, and posts what happened in the chat.
5. **Arrive.** The trip is logged so the delay model's estimates improve over time.

## Riders and talking to Leeway

The app keeps one **rider profile** per rider: their name, home address (where pickups start), time zone and calendar. Send it with `PUT /riders/{rider_id}` when the app starts. The app picks the `rider_id`, for example a random id it stores. Calendar events are what Leeway can see and plan rides for. Today the app sends its mock calendar; a real calendar integration would send the same shape. Create trips with `rider_id` (and `calendar_event_id` when the trip is for a calendar event), and `GET /riders/{rider_id}/trips` lists them all.

Each rider has **one conversation** with Leeway, by text or voice, covering all their trips and calendar appointments. The rider can:

- ask what's coming up, when to be ready, or how likely they are to make it;
- tell Leeway about a new appointment ("I have a dentist appointment Friday at 3 at Smile Dental"). Leeway asks for anything missing, then plans the ride;
- ask Leeway to plan a ride for a calendar appointment;
- replan or book, save a late policy they already know, change their permissions, or update an appointment time after it moves;
- have Leeway phone an appointment with a message ("tell them I'll take the 3:30 slot").

Leeway only acts when the rider asks, and within the rider's permissions and call limits.

Leeway also posts into the conversation on its own, as `kind: "notice"` messages: when a plan is ready, when it called an appointment because a ride is late, and when a call the rider asked for ends.

**Text:** `POST /riders/{rider_id}/messages` with `{"text": "…"}` returns the rider's message and Leeway's reply, usually within a few seconds. Plans and calls Leeway starts run in the background, and their outcomes arrive later as notices. `GET /riders/{rider_id}/messages` returns the whole conversation.

**Voice:** record the rider (hold-to-talk), then:

1. `POST /riders/{rider_id}/voice` as `multipart/form-data` with the recording in field `audio` (webm, ogg, mp4, mp3 or wav). It returns `{"transcript": "…", "messages": [rider message, Leeway's reply]}`. An empty `transcript` means nothing was heard, and then `messages` is empty.
2. `POST /speech` with `{"text": "<Leeway's reply>"}` returns the reply spoken in Leeway's voice as `audio/mpeg`. Play it.

Voice and text share the same conversation, and Leeway keeps spoken replies short.

**Live updates:** `GET /riders/{rider_id}/stream` is a [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream. New messages arrive as event `messages`. New trips, including ones Leeway schedules in the conversation, arrive as event `trips`. Each trip also has `GET /trips/{id}/stream`, where every new activity log entry arrives as event `events`. Each event's `data` is the JSON object:

```js
const rider = new EventSource(`${BASE}/riders/${riderId}/stream?api_key=${KEY}`);
rider.addEventListener("messages", (e) => addToConversation(JSON.parse(e.data)));
rider.addEventListener("trips", (e) => addTrip(JSON.parse(e.data)));
const trip = new EventSource(`${BASE}/trips/${tripId}/stream?api_key=${KEY}`);
trip.addEventListener("events", (e) => addToActivityLog(JSON.parse(e.data)));
```

`GET /trips/{id}/events` is the activity log: a lower-level record of everything the agents did for a trip.

A trip created without a `rider_id` gets its own conversation at `/trips/{id}/messages` (and its notices arrive on its own stream). For a trip with a rider, those endpoints use the rider's conversation.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/trips` | `TripRequest` | `Trip` (202, status `planning`) |
| `GET` | `/trips` | | `Trip[]`, newest first |
| `PUT` | `/riders/{rider_id}` | `RiderProfile` (without `id`) | `RiderProfile`; create or update, including the calendar |
| `GET` | `/riders/{rider_id}` | | `RiderProfile` |
| `GET` | `/riders/{rider_id}/trips` | | `Trip[]`, soonest first |
| `GET` | `/riders/{rider_id}/messages` | | `ChatMessage[]` |
| `POST` | `/riders/{rider_id}/messages` | `{"text": "…"}` | `ChatMessage[]`: the rider's message and Leeway's reply |
| `POST` | `/riders/{rider_id}/voice` | multipart, field `audio` | `{"transcript", "messages"}` |
| `GET` | `/riders/{rider_id}/stream` | | server-sent events `messages` and `trips` |
| `POST` | `/speech` | `{"text": "…"}` | `audio/mpeg`: the text in Leeway's voice |
| `GET` | `/trips/{id}` | | `Trip` |
| `GET` | `/trips/{id}/messages` | | `ChatMessage[]` (the rider's conversation if the trip has one) |
| `POST` | `/trips/{id}/messages` | `{"text": "…"}` | `ChatMessage[]` |
| `GET` | `/trips/{id}/stream` | | server-sent events `events` (and `messages` for trips without a rider) |
| `GET` | `/trips/{id}/events` | | `Event[]` |
| `POST` | `/trips/{id}/plan` | `{"certainty": 0.95}` (optional) | `Trip` (202); replans a `planned` or `failed` trip |
| `PUT` | `/trips/{id}/policy` | `AppointmentPolicy` | `Trip`; the rider already knows the late policy (replan afterwards) |
| `PATCH` | `/trips/{id}/permissions` | any of `may_call_appointment`, `share_rider_name`, `max_calls` | `Trip` |
| `PUT` | `/trips/{id}/appointment-time` | `{"arrive_by": "…"}` | `Trip` (202). Before pickup this clears the booking and replans; during the ride it updates the outlook |
| `POST` | `/trips/{id}/book` | `{"pickup_time": "…"}` | `Trip`; the time must come from the plan |
| `POST` | `/trips/{id}/status` | `{"kind": "van_eta" \| "picked_up" \| "arrived", "at": "…"}` | `Trip`; `at` defaults to now. For `van_eta`, `at` is when the van is expected |
| `GET` | `/trips/{id}/distribution?pickup_time=…` | | arrival histogram and per-sample components, for the dashboard |
| `GET` | `/calibration` | | `[{"promised": 0.9, "observed": 0.87}, …]` |
| `GET` | `/health` | | `{"ok": true}` |

## Shapes

```jsonc
// TripRequest
{
  "rider": {"name": "Maya"},       // "phone" optional, currently unused
  "appointment": {"name": "Eastside Clinic", "phone": "+14155550199"},
  "title": "Neurology",            // what the appointment is for; optional
  "rider_id": "rider_…",           // the rider profile it belongs to; optional
  "calendar_event_id": "cal-neuro", // the calendar event it's for; optional
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

// RiderProfile
{
  "id": "rider_…",
  "name": "Denise Carter",
  "home": "1520 Grand Ave, Oakland",
  "time_zone": "America/Los_Angeles",   // IANA name, from the device
  "calendar": [CalendarEvent],
  "permissions": {"may_call_appointment": true, "share_rider_name": true, "max_calls": 3}
                                        // defaults for trips Leeway schedules
}

// CalendarEvent
{"id": "cal-neuro", "title": "Neurology", "start": "2026-11-03T10:30:00-08:00",
 "place_name": "Kaiser Oakland", "place_address": "3600 Broadway, Oakland", "place_phone": "+15105550123"}

// ChatMessage: thread_id is the rider's id (or the trip's, for a trip without a rider)
{"id": "msg_…", "thread_id": "rider_…", "at": "…", "sender": "rider | agent", "kind": "reply | notice", "text": "…"}

// Event
{"id": "evt_…", "trip_id": "trip_…", "at": "…", "kind": "plan_ready", "message": "…", "data": {}}
```

Event kinds: `planning`, `plan_ready`, `planning_failed`, `policy_learned`, `policy_set`, `permissions_changed`, `appointment_moved`, `booked`, `van_eta`, `picked_up`, `arrived`, `running_late`, `late_handled`, `message_requested`, `call_started`, `call_progress`, `call_ended`, `call_failed`, `call_skipped`.

### Call events

Calls to the appointment show up live in the activity log, so the app can show a call as it happens:

- `call_started`: `data.call_kind` is `policy_inquiry` (planner asking about the grace period), `late_notice` (the rider is running late) or `rider_message` (passing on a message the rider asked for).
- `call_progress`: sent while the call runs, about every 2 seconds when something new was said. `data.lines` holds only the new lines, each `{"role": "agent" | "callee", "text": "…"}`.
- `call_ended`: `data.result` is what the phone agent recorded, `data.transcript` the whole conversation in the same line format, and `data.summary` Cartesia's summary.
  - For `late_notice`: `{reached_someone, acknowledged, appointment_held, notes}`. `appointment_held: false` means the rider can't be seen late.
  - For `policy_inquiry`: `{reached_someone, grace_minutes, can_reschedule, alternative_times, notes}`.
  - For `rider_message`: `{reached_someone, delivered, response}`.
