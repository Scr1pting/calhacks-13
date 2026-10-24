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

- `backend/`: API, agents, delay model
- `frontend/rider/`: rider app
- `frontend/dashboard/`: model and agent showcase
- `docs/`: interface spec (`INTERFACES.md`)