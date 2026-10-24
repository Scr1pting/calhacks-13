"""Trip state shared by the API, the agents and the store."""

from datetime import UTC, datetime
from enum import StrEnum
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


class Outlook(BaseModel):
    """Latest arrival estimate for a booked trip, from the delay model."""

    checked_at: datetime
    p_on_time: float
    expected_arrival: datetime
    minutes_late: int


class LateNotice(BaseModel):
    sent_at: datetime
    minutes_late: int


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
    error: str = ""


class Event(BaseModel):
    """One entry in a trip's activity log, shown to the rider."""

    id: str = Field(default_factory=lambda: new_id("evt"))
    trip_id: str
    at: datetime = Field(default_factory=now)
    kind: str
    message: str
    data: dict = {}


class VoiceTaskKind(StrEnum):
    policy_inquiry = "policy_inquiry"
    late_notice = "late_notice"


class VoiceTask(BaseModel):
    id: str = Field(default_factory=lambda: new_id("vt"))
    trip_id: str
    kind: VoiceTaskKind
    call_id: str = ""
    status: str = "created"  # created | started | completed | failed
    result: dict | None = None  # filled by the webhook tool or transcript extraction
    transcript: list[dict] = []
