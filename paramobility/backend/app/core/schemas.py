"""Trip state shared by the API, the agents and the store."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def now() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class Contact(BaseModel):
    name: str
    phone: str  # E.164, e.g. +14155550123


class Rider(BaseModel):
    name: str
    phone: str = ""


class Permissions(BaseModel):
    """Limits the rider sets. Agents never act outside them."""

    may_call_appointment: bool = True
    share_rider_name: bool = True
    max_calls: int = 3  # calls to the appointment, per trip


class TripRequest(BaseModel):
    rider: Rider
    appointment: Contact
    title: str = ""  # what the appointment is for, e.g. "Neurology"
    rider_id: str = ""  # the rider profile this trip belongs to, if any
    calendar_event_id: str = ""  # the calendar event it was planned from, if any
    origin: str
    dest: str
    arrive_by: datetime
    certainty: float = Field(0.9, ge=0.5, le=0.99)
    permissions: Permissions = Permissions()
    notes: str = ""  # anything the rider wants the agent to know


class TripStatus(StrEnum):
    planning = "planning"
    planned = "planned"
    booked = "booked"
    riding = "riding"
    completed = "completed"
    failed = "failed"


class AppointmentPolicy(BaseModel):
    grace_minutes: int = 0
    can_reschedule: bool | None = None
    alternative_times: str = ""
    notes: str = ""
    source: str = "call"  # "call" | "rider"


class TripOption(BaseModel):
    pickup_time: datetime
    p_on_time: float
    expected_wait_minutes: float


class Plan(BaseModel):
    recommended: TripOption
    options: list[TripOption]
    tradeoff: list[TripOption]
    explanation: str
    created_at: datetime = Field(default_factory=now)


class LiveStatus(BaseModel):
    van_eta: datetime | None = None
    picked_up_at: datetime | None = None
    arrived_at: datetime | None = None
    progress: float | None = None  # share of the ride done, when the van is tracked by GPS
    # (lat, lng) while the rider's phone tracks the ride: where it is, where it started and
    # where it's going, for the app's map. Only the presentation ride sets them for now.
    position: tuple[float, float] | None = None
    origin: tuple[float, float] | None = None
    destination: tuple[float, float] | None = None


class Outlook(BaseModel):
    """Latest arrival estimate for a booked trip, from the delay model."""

    checked_at: datetime
    p_on_time: float
    expected_arrival: datetime
    minutes_late: int


class LateNotice(BaseModel):
    sent_at: datetime
    minutes_late: int


class LateAsk(BaseModel):
    """Leeway asked the rider whether to tell the appointment they're running late."""

    asked_at: datetime
    minutes_late: int
    message: str
    answer: Literal["call", "no"] | None = None


class Trip(TripRequest):
    id: str = Field(default_factory=lambda: new_id("trip"))
    created_at: datetime = Field(default_factory=now)
    status: TripStatus = TripStatus.planning
    policy: AppointmentPolicy | None = None
    plan: Plan | None = None
    booked_pickup: datetime | None = None
    live: LiveStatus = LiveStatus()
    outlook: Outlook | None = None
    calls_used: int = 0
    late_notice: LateNotice | None = None
    late_ask: LateAsk | None = None
    # "presentation": a scripted demo ride (app.demo) whose outlook comes from the demo's clock,
    # so the monitor leaves it alone.
    demo: str = ""
    error: str = ""


class Event(BaseModel):
    """One entry in a trip's activity log, shown to the rider."""

    id: str = Field(default_factory=lambda: new_id("evt"))
    trip_id: str
    at: datetime = Field(default_factory=now)
    kind: str
    message: str
    data: dict = {}


class CalendarEntry(BaseModel):
    """An entry as the phone's calendar has it, before Leeway decides whether it needs a ride."""

    id: str
    title: str
    start: datetime
    end: datetime | None = None
    all_day: bool = False
    location: str = ""
    notes: str = ""


class CalendarEvent(BaseModel):
    """An appointment from the rider's calendar that needs a ride."""

    id: str
    title: str
    start: datetime
    place_name: str
    place_address: str
    place_phone: str = ""


class RiderProfile(BaseModel):
    id: str
    name: str
    home: str  # where pickups start
    time_zone: str = "UTC"  # IANA name, e.g. "America/Los_Angeles"
    calendar: list[CalendarEvent] = []
    # Defaults for trips the chat agent schedules; calls stay off without a phone number.
    permissions: Permissions = Permissions()
    updated_at: datetime = Field(default_factory=now)


class ChatMessage(BaseModel):
    """One message in a conversation with the agent.

    thread_id is the rider's id for their conversation, or a trip's id for a
    trip that has no rider profile.
    """

    id: str = Field(default_factory=lambda: new_id("msg"))
    thread_id: str
    at: datetime = Field(default_factory=now)
    sender: Literal["rider", "agent"]
    # A reply answers the rider; a notice is the agent reaching out on its own.
    kind: Literal["reply", "notice"] = "reply"
    text: str


class VoiceTaskKind(StrEnum):
    policy_inquiry = "policy_inquiry"
    late_notice = "late_notice"
    rider_message = "rider_message"


class VoiceTask(BaseModel):
    id: str = Field(default_factory=lambda: new_id("vt"))
    trip_id: str
    kind: VoiceTaskKind
    call_id: str = ""
    status: str = "created"  # created | started | completed | failed | skipped | blocked
    result: dict | None = None  # filled by the webhook tool or transcript extraction
    transcript: list[dict] = []
