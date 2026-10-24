"""Read a call transcript with Haiku when the phone agent didn't report back itself."""

import json
import logging

import anthropic
from pydantic import BaseModel

from app.core import prompts
from app.core.config import get_settings
from app.core.llm import get_client
from app.core.schemas import VoiceTaskKind

log = logging.getLogger(__name__)


class PolicyFindings(BaseModel):
    reached_someone: bool
    grace_minutes: int | None
    can_reschedule: bool | None
    alternative_times: str
    notes: str


class LateNoticeOutcome(BaseModel):
    reached_someone: bool
    acknowledged: bool
    appointment_held: bool | None
    notes: str


class MessageOutcome(BaseModel):
    reached_someone: bool
    delivered: bool
    response: str


SHAPES: dict[VoiceTaskKind, tuple[type[BaseModel], str]] = {
    VoiceTaskKind.policy_inquiry: (PolicyFindings, "extract_policy"),
    VoiceTaskKind.late_notice: (LateNoticeOutcome, "extract_late_notice"),
    VoiceTaskKind.rider_message: (MessageOutcome, "extract_message"),
}


async def from_transcript(kind: VoiceTaskKind, transcript: list[dict]) -> dict | None:
    shape, prompt = SHAPES[kind]
    lines = "\n".join(f"{t.get('role')}: {t.get('text') or ''}" for t in transcript)
    try:
        response = await get_client().messages.parse(
            model=get_settings().extract_model,
            max_tokens=4000,
            output_config={"effort": "low"},
            system=prompts.load(prompt),
            messages=[{"role": "user", "content": f"<transcript>\n{lines}\n</transcript>"}],
            output_format=shape,
        )
    except anthropic.APIError:
        log.warning("transcript extraction failed", exc_info=True)
        return None
    if response.stop_reason == "refusal" or response.parsed_output is None:
        return None
    return json.loads(response.parsed_output.model_dump_json())
