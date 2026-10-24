"""Create the Cartesia phone agents and their webhook tools.

    python -m app.voice.setup [--model claude-haiku-5.5] [--voice-id ID]

Needs CARTESIA_API_KEY, PUBLIC_BASE_URL (https) and VOICE_WEBHOOK_SECRET.
Prints the env lines to add to the server's .env.
"""

import argparse
import asyncio

from app.core import prompts
from app.core.config import get_settings

from .cartesia import CartesiaClient

GREETINGS = {
    "policy": (
        "Hi, this is an automated assistant calling on behalf of {{rider_name}} about their "
        "{{appointment_time}} appointment. Do you have a quick moment?"
    ),
    "late": (
        "Hi, this is an automated assistant calling on behalf of {{rider_name}}, who has an "
        "appointment at {{appointment_time}}."
    ),
}


def _webhook_tool(name: str, description: str, path: str, fields: dict) -> dict:
    s = get_settings()
    return {
        "type": "webhook",
        "name": name,
        "description": description,
        "pre_tool_speech": "off",
        "execution_mode": "immediate",
        "response_timeout_secs": 15,
        "api_schema": {
            "url": f"{s.public_base_url.rstrip('/')}{path}",
            "method": "POST",
            "request_body_schema": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "dynamic_variable": "task_id"},
                    **fields,
                },
                "required": ["reached_someone"],
            },
            "authentication": {
                "mode": "bearer",
                "token": {"type": "secret", "secret_value": s.voice_webhook_secret},
            },
        },
    }


POLICY_TOOL = (
    "record_policy",
    "Save what the appointment said about arriving late. Call once you have the answers.",
    "/voice/webhooks/policy",
    {
        "reached_someone": {
            "type": "boolean",
            "description": "True if you spoke with a person who could answer, false for voicemail.",
        },
        "grace_minutes": {
            "type": "integer",
            "description": "Minutes after the appointment time the rider can still be seen. "
            "0 if there is no grace period. Leave out if they didn't say.",
        },
        "can_reschedule": {
            "type": "boolean",
            "description": "Whether the appointment can be moved if the ride runs very late.",
        },
        "alternative_times": {
            "type": "string",
            "description": "Other open times they mentioned, as they said them.",
        },
        "notes": {"type": "string", "description": "Anything else the rider should know."},
    },
)

LATE_TOOL = (
    "record_late_notice",
    "Save the outcome of telling the appointment the rider is running late.",
    "/voice/webhooks/late-notice",
    {
        "reached_someone": {
            "type": "boolean",
            "description": "True if you spoke with a person, false for voicemail.",
        },
        "acknowledged": {
            "type": "boolean",
            "description": "True if they confirmed they understood, or you left a voicemail.",
        },
        "appointment_held": {
            "type": "boolean",
            "description": "True if the rider can still be seen, false if it must be moved.",
        },
        "notes": {"type": "string", "description": "Anything the rider should know."},
    },
)


def _agent(name: str, prompt: str, greeting: str, tool_id: str, model: str, voice: str) -> dict:
    config = {
        "instructions": prompts.load(prompt),
        "initial_message": greeting,
        "model": {"id": model},
        "language": {"primary": "en"},
        "audio": {"output": {"voice_id": voice}},
        "tools": [{"id": tool_id}],
        "system_tools": {"end_call": {"description": None, "pre_tool_speech": "force"}},
    }
    return {"name": name, "config": config}


async def _tool(c: CartesiaClient, existing: dict[str, dict], spec: tuple) -> dict:
    """Reuse a tool from an earlier run (refreshing its URL and secret) or create it."""
    body = _webhook_tool(*spec)
    if spec[0] in existing:
        tool_id = existing[spec[0]]["id"]
        await c.update_tool(tool_id, {k: v for k, v in body.items() if k != "type"})
        return existing[spec[0]]
    return await c.create_tool(body)


async def _upsert_agent(c: CartesiaClient, existing: dict[str, dict], agent: dict) -> dict:
    if agent["name"] in existing:
        found = existing[agent["name"]]
        await c.update_agent(found["id"], {"config": agent["config"]})
        return found
    return await c.create_agent(agent)


async def main(model: str, voice: str) -> None:
    s = get_settings()
    https = s.public_base_url.startswith("https://")
    if not (s.cartesia_api_key and s.voice_webhook_secret and https):
        raise SystemExit("Set CARTESIA_API_KEY, VOICE_WEBHOOK_SECRET and an https PUBLIC_BASE_URL.")

    async with CartesiaClient() as c:
        available = {m["id"] for m in await c.list_models()}
        if model not in available:
            raise SystemExit(f"{model} is not offered. Available: {sorted(available)}")

        if not voice:
            english = [v for v in await c.list_voices() if v.get("language") == "en"]
            voice = english[0]["id"]
            print(f"Using voice {english[0]['name']} ({voice}); pass --voice-id to change it.")

        existing = {t["name"]: t for t in await c.list_tools()}
        policy_tool = await _tool(c, existing, POLICY_TOOL)
        late_tool = await _tool(c, existing, LATE_TOOL)
        agents = {a["name"]: a for a in await c.list_agents()}
        policy_agent = await _upsert_agent(c, agents, _agent(
            "Paramobility policy inquiry", "voice_policy_inquiry", GREETINGS["policy"],
            policy_tool["id"], model, voice,
        ))
        late_agent = await _upsert_agent(c, agents, _agent(
            "Paramobility late notice", "voice_late_notice", GREETINGS["late"],
            late_tool["id"], model, voice,
        ))
        numbers = await c.list_phone_numbers()

    print("Add to .env:")
    print(f"CARTESIA_POLICY_AGENT_ID={policy_agent['id']}")
    print(f"CARTESIA_LATE_AGENT_ID={late_agent['id']}")
    if numbers:
        print(f"CARTESIA_FROM_NUMBER_ID={numbers[0]['id']}  # {numbers[0]['number']}")
    else:
        print("# No phone numbers yet: get one in the Cartesia dashboard, then set "
              "CARTESIA_FROM_NUMBER_ID to its id.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="claude-haiku-5.5")
    parser.add_argument("--voice-id", default="")
    args = parser.parse_args()
    asyncio.run(main(args.model, args.voice_id))
