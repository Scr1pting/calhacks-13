# Paramobility

Paratransit riders often book hours earlier than they need to, because a late pickup can mean a missed doctor's appointment or shift. The system is planned around averages ("85% on time"), but riders feel the bad days.

Paramobility is a trip planner for paratransit riders. It helps them decide **how early to book**, using a certainty level they choose.

## What it does

- **Plans:** estimates the full range of possible arrival times (pickup lateness, traffic, shared-ride detours) and shows the trade-off, e.g. *"Book for 12:40: 95% on time, about 35 min wait."*
- **Coordinates:** an AI agent calls the appointment to find out how flexible it is (grace period, other time slots) and uses that in the plan.
- **Monitors:** if the van runs late, it warns the appointment ahead of time.
- **Learns:** riders log their real pickup times, so the estimates get more accurate over time.

The rider always stays in control. The agent only acts within limits the rider sets, and every number comes from the model, not from the AI.

## Structure

All of it lives in `paramobility/`:

- `backend/`: API, agents, delay model
  - `app/model/`: the delay model (interface stubs; `app/tools/fake_model.py` stands in until it's implemented)
  - `app/agents/`: planner and late-notice agents (Claude Sonnet); rider chat and transcript extraction (Claude Haiku)
  - `app/voice/`: Cartesia phone agents (Claude Haiku)
  - `prompts/`: every prompt the agents use
- `frontend/rider/`: rider app
- `frontend/dashboard/`: model and agent showcase
- `deploy/`: Docker Compose, Caddy, and the GitHub webhook that redeploys after CI passes
- `docs/`: API spec ([`INTERFACES.md`](paramobility/docs/INTERFACES.md)) and deployment ([`DEPLOY.md`](paramobility/docs/DEPLOY.md))

## Running the backend locally

```bash
cd paramobility/backend
python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"   # Windows: .venv\Scripts\
cp .env.example .env    # or put the values in the repo-root .env
.venv/bin/uvicorn app.main:app --reload
.venv/bin/pytest
```

## Running the rider app

```bash
cd paramobility/frontend/rider
cp .env.example .env.local   # set VITE_API_KEY; pick the number to call in the demo panel
npm install
npm run dev
```

The app talks to the deployed backend by default. The calendar and the East Bay Paratransit booking call are mocks (`src/mocks/`); planning, monitoring, calls to the clinic and chat are real. Hold the mic on the Ask Leeway bar to talk to Leeway: ask what's coming up, or tell it about a new appointment and it plans the ride. The side panel sends simulated ride updates, such as a late van.

## Voice (Cartesia)

Leeway talks in two places, both with Cartesia and in the same voice: on the phone, calling the rider's appointment, and in the app, when the rider holds the mic.

### Setup

1. In the [Cartesia dashboard](https://play.cartesia.ai), create an API key and get a phone number.
2. In `paramobility/backend/.env`, set `CARTESIA_API_KEY`, `PUBLIC_BASE_URL` (the public https URL Cartesia calls the webhooks on) and `VOICE_WEBHOOK_SECRET` (any long random string).
3. Create the phone agents and their webhook tools. Run this again after changing a prompt; it updates the agents in place:

   ```bash
   cd paramobility/backend
   .venv/bin/python -m app.voice.setup   # --voice-id ID to pick the voice, --model to pick the LLM
   ```

4. Copy the `CARTESIA_*_AGENT_ID` and `CARTESIA_FROM_NUMBER_ID` lines it prints into `.env`.
5. Approve the numbers Leeway may call: list them in `CALL_ALLOWLIST`, or set `CALL_PIN` and add them in the app's demo panel.

Without `CARTESIA_API_KEY` and `CARTESIA_FROM_NUMBER_ID`, everything else still runs; calls are logged as skipped. Keys only go in `.env`, which is git-ignored.

### Cartesia features used

- **Agents API** (`app/voice/setup.py`): three phone agents, each with its own prompt in `prompts/voice_*.md`, Claude Haiku as the LLM and a greeting filled in with the call's details.
  - *Policy inquiry*: asks the appointment how late the rider can arrive and still be seen, and whether the slot can be moved. The planner uses the answer.
  - *Late notice*: tells the appointment the rider is running late, with the delay model's arrival estimate, and asks whether they can still be seen.
  - *Rider message*: passes on a message the rider dictated, and brings back the reply.
- **Outbound calls** (`app/voice/calls.py`): `/agents/calls` with dynamic variables (rider name, appointment time, expected arrival, minutes late).
- **Webhook tools** (`app/api/voice.py`): during the call, the agent reports its findings as typed fields (`grace_minutes`, `can_reschedule`, `appointment_held`, …) to a bearer-authenticated endpoint. The app acts on those fields.
- **`end_call` system tool**, set to always say goodbye first.
- **Call transcripts and summaries**: polled every 2 seconds while the call runs and shown live in the app.
- **Ink-Whisper speech-to-text** (`app/voice/speech.py`, `POST /riders/{id}/voice`): hold-to-talk in the app.
- **Sonic 3.6 text-to-speech** (`POST /speech`): reads Leeway's replies aloud in the phone agents' voice.

### Safeguards

- Leeway asks the rider before every call, and stays within each trip's permissions (whether it may call, whether it may say the rider's name, how many calls).
- Agents say they are automated, share only the rider's name, the appointment time and the delay, and give arrival times as estimates.
- `app/voice/numbers.py` checks every number on the server before dialling: US/Canada only; never real paratransit agency lines, premium-rate numbers or Leeway's own number; only approved numbers; at most `CALL_LIMIT_PER_HOUR` (4) and `CALL_LIMIT_PER_DAY` (12) calls per number.
- If the agent reaches voicemail, it leaves a short message. If it hangs up without reporting, Claude Haiku reads the transcript instead. If a tool call fails, the agent doesn't tell the person on the phone and closes as usual.

### Known limitations

- The East Bay Paratransit booking call is a mock (`frontend/rider/src/mocks/paratransit.js`): EBP only books by phone, and we never call real agency lines.
- In-app voice takes turns (record, transcribe, reply, speak). The rider can't interrupt Leeway while it is speaking.
- Call transcripts are polled every 2 seconds rather than streamed.
- English only; US and Canadian numbers only.
- The phone agents are shared, so a local backend and the deployed one use the same agents. A report for a call the other backend placed is accepted and ignored.

## Fleet dashboard

A 3D view of the simulated East Bay Paratransit day (`paramobility/backend/paratransit-sim`): every van drives its real road routes through an extruded 3D city, coloured by how far behind plan it is. It shows live counts, late pickups with their causes, and a chase camera that follows Maria, the demo rider.

```bash
cd paramobility/frontend/dashboard
npm install --legacy-peer-deps   # plain npm install trips an npm peer-dependency bug
npm run dev                      # http://localhost:5174
npm run data                     # rebuild public/data/fleet.json after re-running the simulator
```

Handy links: `?film` plays a two-minute film of the day that tells the problem through Maria's morning, `?story` a minimal 90-second cut that builds it up on a blank page (Space pauses, Esc exits, `?film=40` or `?story=40` starts 40 seconds in), `?t=10:15` starts at that time, and `?follow=maria` opens on Maria's ride. Map data is open and needs no keys: buildings, roads and water come from OpenStreetMap via OpenFreeMap, and hillshading from AWS Terrain Tiles.

`?live` is the pitch with a real phone in it: why paratransit exists, then one ride whose van gets stuck in traffic, Leeway asking the rider, and Leeway calling "the clinic" live, on a phone in the room, to move the appointment. Set it up once per browser by opening it with `#key=<API_KEY>&phone=<+1 number>`; the number must be approved on the server (`CALL_ALLOWLIST`, or added with `CALL_PIN`), and each number takes `CALL_LIMIT_PER_HOUR` calls an hour (4 by default), so raise that for rehearsals. Without the setup, or if the call can't be placed, the story plays a scripted call marked as a rehearsal. Arrow keys or a clicker step through it (`&present`), and the call shot waits until the call has ended.

`?presentation` tells the same pitch on the backend's presentation ride (`paramobility/backend/app/demo/presentation.py`): the van picks Denise up and heads straight up International Blvd toward Highland Hospital, then turns off to pick up another rider in Alameda; when her chance of making the appointment drops to 50% Leeway asks her, then calls the clinic to say she'll be a few minutes late. The ride is an example made to tell that story on real streets: `python -m scripts.example_ride --appointment 11:20 --pickup 10:38 --other-board 5` from `backend/` rebuilds it (OpenRouteService), and `scripts/demo_ride.py` swaps in a ride from the simulated day instead. Leeway only knows where the van is once she's in it (her phone), so the film shows no van before the pickup. The phone in the film is the rider app itself (its `useLeewayFlow` hook and screens), talking to a stand-in for the server (`frontend/dashboard/src/film/riderApi.js`) that has the presentation trip as the film's clock says; the film only taps its buttons. The rider app follows a presentation trip on its own too (Trip.demo): the day's ride while she waits, the live trip with the ride's real position (`live.position`, `origin`, `destination`), Leeway's question on the decision screen, then the call and its outcome. The film drives the server: it posts its clock to `/presentation/clock`, so the rider app on a real phone shows the same ride at the same moment, and its shots are timed from the server's timeline, so Leeway asks when the server's model says. Set it up once per browser with `#key=<API_KEY>&phone=%2B1…&rider=<the phone's rider id>` (`%2B` is the `+`). Each run then starts a fresh presentation trip for that rider; without `rider` it follows the trip the phone's demo panel started. Without a key it plays offline from `frontend/dashboard/public/data/presentation.json` (rebuild it with `python -m scripts.presentation_snapshot` from `backend/`). If the real call can't be placed or fails, the scripted call plays.