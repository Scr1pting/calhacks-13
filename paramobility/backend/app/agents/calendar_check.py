"""Decide with Haiku which of the rider's calendar entries need a ride.

Each entry is judged on its own. Verdicts are cached by the entry's content (and the prompt), so
the app can sync the whole calendar on every start without asking again about
entries that didn't change.
"""

import asyncio
import hashlib
import json
import logging
from datetime import timedelta, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import anthropic
from pydantic import BaseModel

from app.core import prompts
from app.core.config import get_settings
from app.core.llm import get_client
from app.core.schemas import CalendarEntry, CalendarEvent, RiderProfile, now
from app.core.store import get_store

log = logging.getLogger(__name__)

HORIZON = timedelta(days=14)  # the app plans rides up to two weeks ahead
PARALLEL = 8


class Verdict(BaseModel):
    needs_ride: bool
    reason: str
    title: str  # what the appointment is for, e.g. "Neurology"
    place_name: str
    place_address: str
    place_phone: str


class CalendarCheck(BaseModel):
    calendar: list[CalendarEvent]
    skipped: int  # upcoming entries that don't need a ride


def _key(entry: CalendarEntry, home: str) -> str:
    # The prompt is part of the key, so changing it asks about every entry again.
    raw = json.dumps([entry.model_dump(mode="json"), home, prompts.load("calendar_check")],
                     sort_keys=True)
    return "calendar_verdict:" + hashlib.sha256(raw.encode()).hexdigest()[:32]


def _describe(entry: CalendarEntry, rider: RiderProfile) -> str:
    end = entry.end.isoformat() if entry.end else ""
    return (
        f"<rider_home>{rider.home}</rider_home>\n<entry>\n"
        f"title: {entry.title}\nstart: {entry.start.isoformat()}\nend: {end}\n"
        f"all_day: {entry.all_day}\nlocation: {entry.location}\nnotes: {entry.notes}\n</entry>"
    )


async def judge(entry: CalendarEntry, rider: RiderProfile) -> Verdict | None:
    """Haiku's verdict on one entry, or None if it couldn't decide (then it's asked again later)."""
    store = get_store()
    key = _key(entry, rider.home)
    if (cached := store.get_json(key)) is not None:
        return Verdict.model_validate(cached)
    try:
        response = await get_client().messages.parse(
            model=get_settings().calendar_model,
            max_tokens=2000,
            output_config={"effort": "low"},
            system=prompts.load("calendar_check"),
            messages=[{"role": "user", "content": _describe(entry, rider)}],
            output_format=Verdict,
        )
    except anthropic.APIError:
        log.warning("calendar check failed for %s", entry.id, exc_info=True)
        return None
    if response.stop_reason == "refusal" or response.parsed_output is None:
        return None
    verdict = response.parsed_output
    store.put_json(key, verdict.model_dump())
    return verdict


def _zone(rider: RiderProfile) -> tzinfo | None:
    try:
        return ZoneInfo(rider.time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        return None


async def check(rider: RiderProfile, entries: list[CalendarEntry]) -> CalendarCheck:
    """The upcoming entries that need a ride, as calendar events, and how many were skipped."""
    current = now()
    upcoming = [e for e in entries if current < e.start <= current + HORIZON]
    gate = asyncio.Semaphore(PARALLEL)

    async def one(entry: CalendarEntry) -> Verdict | None:
        async with gate:
            return await judge(entry, rider)

    verdicts = await asyncio.gather(*(one(e) for e in upcoming))
    # Phones often send UTC; times in messages read better in the rider's own zone.
    zone = _zone(rider)
    calendar = [
        CalendarEvent(
            id=e.id,
            title=v.title or e.title,
            start=e.start.astimezone(zone) if zone else e.start,
            place_name=v.place_name or e.location,
            place_address=v.place_address or e.location,
            place_phone=v.place_phone,
        )
        for e, v in zip(upcoming, verdicts, strict=True)
        if v and v.needs_ride and (v.place_address or e.location)
    ]
    calendar.sort(key=lambda c: c.start)
    return CalendarCheck(calendar=calendar, skipped=len(upcoming) - len(calendar))
