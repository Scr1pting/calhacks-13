# Deployment

The API runs on the Hetzner server `2.29.114.245` (Ubuntu 26.04, ARM64) at `https://api.cal.fuzz.li`. `*.cal.fuzz.li` points at the server.

## How a deploy happens

1. You push to `main`.
2. GitHub Actions runs **CI** (`.github/workflows/ci.yml`): `ruff check` and `pytest`.
3. When CI finishes, GitHub sends a "workflow run" webhook to `https://hooks.cal.fuzz.li/github`.
4. The listener on the server (`deploy/webhook/github_webhook.py`, systemd service `paramobility-webhook`) checks the signature. It deploys only a **successful CI run for a push to `main`**; every other delivery is ignored.
5. `deploy/deploy.sh` checks out exactly that commit in `/opt/paramobility/repo`, rebuilds the image on the server, builds the fleet dashboard (in a throwaway `node:22-slim` container), restarts the containers, and waits for the API to report healthy.

Pull requests run CI but never deploy. A failed CI run never deploys.

Docker Compose (`deploy/docker-compose.yml`, project `paramobility`) runs:

- `api`: the backend, built from `backend/`, with SQLite on the `api-data` volume.
- `caddy`: HTTPS with automatic Let's Encrypt certificates. It proxies `api.cal.fuzz.li` to `api` and `hooks.cal.fuzz.li` to the webhook listener on the host, and serves the fleet dashboard's static build at `dashboard.cal.fuzz.li`.

## One-time GitHub setup

1. **Deploy key.** The server pulls the private repo with its own read-only key. In GitHub, open the repo's Settings → Deploy keys → Add deploy key, paste the key printed by `install-webhook.sh`, and leave "Allow write access" off. To print it again:

   ```bash
   ssh root@2.29.114.245 'cat /root/.ssh/github_deploy_key.pub'
   ```

2. **Webhook.** In GitHub, open the repo's Settings → Webhooks → Add webhook:
   - Payload URL: `https://hooks.cal.fuzz.li/github`
   - Content type: `application/json`
   - Secret: the value of `GITHUB_WEBHOOK_SECRET` in `/opt/paramobility/webhook.env` on the server, without the `GITHUB_WEBHOOK_SECRET=` part. To print just the value: `ssh root@2.29.114.245 "sed -n 's/^GITHUB_WEBHOOK_SECRET=//p' /opt/paramobility/webhook.env"`
   - Events: "Let me select individual events" → only **Workflow runs**

   GitHub sends a ping when the webhook is saved, and the listener answers `pong`.

## Deploying by hand

```bash
ssh root@2.29.114.245 'bash /opt/paramobility/repo/paramobility/deploy/deploy.sh'        # latest main
ssh root@2.29.114.245 'bash /opt/paramobility/repo/paramobility/deploy/deploy.sh <sha>'  # a specific commit on main
```

## Logs

```bash
ssh root@2.29.114.245 'tail -n 50 /opt/paramobility/deploy.log'          # deploys
ssh root@2.29.114.245 'journalctl -u paramobility-webhook -n 50'          # webhook deliveries
ssh root@2.29.114.245 'cd /opt/paramobility/repo/paramobility/deploy && docker compose logs -f api'
```

GitHub also shows each delivery and the listener's response under Settings → Webhooks → Recent Deliveries. You can redeliver one from there.

## Configuration

Secrets live in `/opt/paramobility/.env` on the server, outside the git checkout. Deploys never touch this file. After changing it, restart the API:

```bash
ssh root@2.29.114.245 'cd /opt/paramobility/repo/paramobility/deploy && PARAMOBILITY_ENV_FILE=/opt/paramobility/.env docker compose up -d api'
```

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Planner and late-notice agent (Sonnet), rider chat and transcript extraction (Haiku) |
| `API_KEY` | Clients must send this as `X-API-Key` |
| `PUBLIC_BASE_URL` | `https://api.cal.fuzz.li`; the base URL for the voice webhooks |
| `GOOGLE_MAPS_KEY` | Drive times and geocoding for the delay model; enable the Routes and Geocoding APIs. Without it, `ORS_API_KEY` (OpenRouteService, no traffic). Planning needs one |
| `CARTESIA_API_KEY` | Cartesia voice |
| `CARTESIA_FROM_NUMBER_ID` | The number calls come from (its `ap_…` id, or the `+1…` number) |
| `CARTESIA_POLICY_AGENT_ID`, `CARTESIA_LATE_AGENT_ID`, `CARTESIA_MESSAGE_AGENT_ID` | Printed by `python -m app.voice.setup` |
| `VOICE_WEBHOOK_SECRET` | Bearer token Cartesia sends to `/voice/webhooks/*` |
| `CALL_PIN` | PIN the rider app's demo panel needs to approve a new number to call. Unset: numbers can't be added from the app |
| `CALL_ALLOWLIST` | Comma-separated numbers that may always be called (E.164 or as typed) |
| `CALL_LIMIT_PER_HOUR`, `CALL_LIMIT_PER_DAY` | Calls per number (default 4 an hour, 12 a day) |

The webhook listener's own settings are in `/opt/paramobility/webhook.env`: `GITHUB_WEBHOOK_SECRET`, `DEPLOY_BRANCH`, and `DEPLOY_WORKFLOW` (must match the workflow's `name:`).

## Cartesia agents

`python -m app.voice.setup`, run from `paramobility/backend` with the same `CARTESIA_API_KEY`, `PUBLIC_BASE_URL` and `VOICE_WEBHOOK_SECRET` as the server, creates or updates:

- the webhook tools `record_policy`, `record_late_notice` and `record_message_outcome`,
- the agents "Paramobility policy inquiry", "Paramobility late notice" and "Paramobility rider message" on `claude-haiku-5.5`.

Re-run it after editing `prompts/voice_*.md` or rotating `VOICE_WEBHOOK_SECRET`. It updates the existing tools and agents in place.

## Server setup from scratch

```bash
ssh root@<server> 'bash -s' < paramobility/deploy/bootstrap.sh        # Docker, git, firewall
ssh root@<server> 'bash -s' < paramobility/deploy/install-webhook.sh  # prints the deploy key on first run
# add the deploy key on GitHub, then run install-webhook.sh again
```

Then fill in `/opt/paramobility/.env`, add the GitHub webhook, and run `deploy.sh` once by hand.
