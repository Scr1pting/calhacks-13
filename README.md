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

## Fleet dashboard

A 3D view of the simulated East Bay Paratransit day (`paramobility/backend/paratransit-sim`): every van drives its real road routes through an extruded 3D city, coloured by how far behind plan it is. It shows live counts, late pickups with their causes, and a chase camera that follows Maria, the demo rider.

```bash
cd paramobility/frontend/dashboard
npm install --legacy-peer-deps   # plain npm install trips an npm peer-dependency bug
npm run dev                      # http://localhost:5174
npm run data                     # rebuild public/data/fleet.json after re-running the simulator
```

Handy links: `?film` plays a two-minute film of the day that tells the problem through Maria's morning, `?story` a minimal 90-second cut that builds it up on a blank page (Space pauses, Esc exits, `?film=40` or `?story=40` starts 40 seconds in), `?t=10:15` starts at that time, and `?follow=maria` opens on Maria's ride. Map data is open and needs no keys: buildings, roads and water come from OpenStreetMap via OpenFreeMap, and hillshading from AWS Terrain Tiles.