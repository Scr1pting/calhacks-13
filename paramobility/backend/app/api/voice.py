"""Webhooks the Cartesia phone agents call mid-conversation to report what they learned."""

import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.store import get_store

log = logging.getLogger(__name__)


def require_webhook_secret(authorization: str = Header("")) -> None:
    secret = get_settings().voice_webhook_secret
    if not secret or not secrets.compare_digest(authorization, f"Bearer {secret}"):
        raise HTTPException(401, "invalid webhook token")


router = APIRouter(prefix="/voice/webhooks", dependencies=[Depends(require_webhook_secret)])


# Same fields as app.agents.extract, but lenient: the phone agent may leave some out.

class PolicyReport(BaseModel):
    task_id: str
    reached_someone: bool = True
    grace_minutes: int | None = None
    can_reschedule: bool | None = None
    alternative_times: str = ""
    notes: str = ""


class LateNoticeReport(BaseModel):
    task_id: str
    reached_someone: bool = True
    acknowledged: bool = False
    appointment_held: bool | None = None
    notes: str = ""


class MessageReport(BaseModel):
    task_id: str
    reached_someone: bool = True
    delivered: bool = False
    response: str = ""


def _save(report: BaseModel, kind: str) -> None:
    store = get_store()
    task = store.get_voice_task(report.task_id)
    if task is None or task.kind != kind:
        # Another backend placed this call (the agents are shared, e.g. with a
        # local dev server). Accept it anyway: an error here is read out to the
        # person on the phone, and the backend that placed the call reads the
        # transcript instead.
        log.warning("voice report for unknown %s task %s", kind, report.task_id)
        return
    task.result = report.model_dump(exclude={"task_id"})
    store.put_voice_task(task)


# Cartesia passes the response body to the phone agent as the tool result.

@router.post("/policy", response_class=PlainTextResponse)
async def report_policy(report: PolicyReport) -> str:
    _save(report, "policy_inquiry")
    return "Saved. Thank them for their help and end the call."


@router.post("/late-notice", response_class=PlainTextResponse)
async def report_late_notice(report: LateNoticeReport) -> str:
    _save(report, "late_notice")
    return "Saved. Thank them and end the call."


@router.post("/message", response_class=PlainTextResponse)
async def report_message(report: MessageReport) -> str:
    _save(report, "rider_message")
    return "Saved. Thank them and end the call."
