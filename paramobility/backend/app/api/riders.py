"""Rider API: profile and calendar, all trips, and the conversation with Leeway by text or voice."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.agents import calendar_check, chat
from app.core.schemas import (
    CalendarEntry,
    CalendarEvent,
    ChatMessage,
    Permissions,
    RiderProfile,
    Trip,
    now,
)
from app.core.store import get_store
from app.voice import speech

from .streams import sse
from .trips import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])

MAX_RECORDING_BYTES = 10 * 1024 * 1024


def _rider(rider_id: str) -> RiderProfile:
    rider = get_store().get_rider(rider_id)
    if rider is None:
        raise HTTPException(404, "rider not found")
    return rider


class RiderUpdate(BaseModel):
    name: str
    home: str
    time_zone: str = "UTC"
    calendar: list[CalendarEvent] | None = None  # left out: keep the synced calendar
    permissions: Permissions = Permissions()


@router.put("/riders/{rider_id}")
async def put_rider(rider_id: str, body: RiderUpdate) -> RiderProfile:
    """Create or update the rider, including their calendar (the app syncs it on start)."""
    fields = body.model_dump()
    if body.calendar is None:
        old = get_store().get_rider(rider_id)
        fields["calendar"] = old.calendar if old else []
    rider = RiderProfile(id=rider_id, updated_at=now(), **fields)
    get_store().put_rider(rider)
    return rider


@router.get("/riders/{rider_id}")
async def get_rider(rider_id: str) -> RiderProfile:
    return _rider(rider_id)


class CalendarSync(BaseModel):
    entries: list[CalendarEntry] = Field(max_length=500)


@router.put("/riders/{rider_id}/calendar")
async def put_calendar(rider_id: str, body: CalendarSync) -> calendar_check.CalendarCheck:
    """Sync the phone's calendar: Haiku keeps the entries that need a ride.

    They become the rider's calendar. The rest only count towards `skipped`.
    """
    result = await calendar_check.check(_rider(rider_id), body.entries)

    def change(r: RiderProfile) -> None:
        r.calendar = result.calendar
        r.updated_at = now()

    get_store().update_rider(rider_id, change)
    return result


@router.get("/riders/{rider_id}/trips")
async def rider_trips(rider_id: str) -> list[Trip]:
    _rider(rider_id)
    return get_store().rider_trips(rider_id)


@router.get("/riders/{rider_id}/messages")
async def rider_messages(rider_id: str) -> list[ChatMessage]:
    _rider(rider_id)
    return get_store().messages(rider_id)


class RiderMessage(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/riders/{rider_id}/messages")
async def send_rider_message(rider_id: str, body: RiderMessage) -> list[ChatMessage]:
    """The rider writes to Leeway. Returns their message and Leeway's reply."""
    _rider(rider_id)
    return await chat.reply(rider_id, body.text)


class VoiceTurn(BaseModel):
    transcript: str
    messages: list[ChatMessage]


@router.post("/riders/{rider_id}/voice")
async def voice_message(rider_id: str, audio: Annotated[UploadFile, File()]) -> VoiceTurn:
    """The rider spoke to Leeway: transcribe the recording, then answer like a text message.

    Speak the reply with POST /speech.
    """
    _rider(rider_id)
    data = await audio.read(MAX_RECORDING_BYTES + 1)
    if len(data) > MAX_RECORDING_BYTES:
        raise HTTPException(413, "recording too long")
    try:
        text = await speech.transcribe(data, audio.filename or "speech.webm",
                                       audio.content_type or "audio/webm")
    except speech.SpeechError as e:
        raise HTTPException(502, str(e)) from e
    if not text:
        return VoiceTurn(transcript="", messages=[])
    return VoiceTurn(transcript=text,
                     messages=await chat.reply(rider_id, text, tag="rider_voice"))


@router.get("/riders/{rider_id}/stream")
async def rider_stream(rider_id: str, request: Request):
    """Server-sent events: `messages` for the conversation, `trips` when a new trip is created."""
    _rider(rider_id)
    return sse(request, rider_id)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/speech", response_class=Response)
async def speak(body: SpeechRequest) -> Response:
    """Leeway's voice for a piece of text, as MP3."""
    try:
        audio = await speech.synthesize(body.text)
    except speech.SpeechError as e:
        raise HTTPException(502, str(e)) from e
    return Response(audio, media_type="audio/mpeg")
