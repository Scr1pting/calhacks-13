import asyncio
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.agents import chat, planner
from app.api import riders
from app.core import bus
from app.core.schemas import CalendarEvent, ChatMessage, RiderProfile, Trip, TripStatus, now
from app.core.thread import notify_rider
from app.main import app
from app.tools import model_tools


@pytest.fixture
def plans_started(monkeypatch):
    started = []

    async def fake_plan_trip(trip_id):
        started.append(trip_id)

    monkeypatch.setattr(planner, "plan_trip", fake_plan_trip)
    return started


@pytest.fixture
def rider(store):
    soon = (now() + timedelta(days=2)).replace(microsecond=0)
    profile = RiderProfile(
        id="rider_1",
        name="Maya",
        home="1520 Grand Ave, Oakland",
        calendar=[CalendarEvent(id="cal-dentist", title="Dentist", start=soon,
                                place_name="Smile Dental", place_address="1 Main St, Oakland")],
    )
    store.put_rider(profile)
    return profile


@pytest.fixture
def trip(store, rider, trip):
    """The shared trip fixture, belonging to the rider."""
    return store.update_trip(trip.id, lambda t: setattr(t, "rider_id", rider.id))


@pytest.fixture
def tools(rider):
    return {t.name: t for t in chat.build_tools(rider.id)}


@pytest.fixture
def planned(trip, store):
    """The trip with a plan from the model, as if the planner had run."""
    opts = model_tools.options(trip, trip.certainty)
    rows = model_tools.tradeoff(trip)

    def change(t):
        t.plan = planner.Plan(recommended=opts[0], options=opts, tradeoff=rows, explanation="ok")
        t.status = TripStatus.planned

    return store.update_trip(trip.id, change)


async def test_schedule_ride_plans_a_new_appointment(rider, store, tools, plans_started):
    queue = bus.subscribe(rider.id)
    when = (now() + timedelta(days=3)).isoformat()
    result = await tools["schedule_ride"].func(
        title="Eye exam", arrive_by=when, place_name="Vision Center", place_address="9 Elm St"
    )
    await asyncio.sleep(0)  # let the spawned planner start
    (trip,) = [t for t in store.rider_trips(rider.id) if t.title == "Eye exam"]
    assert trip.id in result and plans_started == [trip.id]
    assert trip.origin == rider.home
    assert trip.permissions.may_call_appointment is False  # no phone number given
    kind, data = queue.get_nowait()
    assert kind == "trips" and trip.id in data
    bus.unsubscribe(rider.id, queue)


async def test_calendar_appointments_drop_off_once_planned(rider, tools, plans_started):
    assert [e["id"] for e in chat.context(rider.id)["calendar_appointments_without_a_ride"]] == [
        "cal-dentist"
    ]
    event = rider.calendar[0]
    await tools["schedule_ride"].func(
        title=event.title, arrive_by=event.start.isoformat(), place_name=event.place_name,
        place_address=event.place_address, calendar_event_id=event.id,
    )
    assert chat.context(rider.id)["calendar_appointments_without_a_ride"] == []


async def test_past_times_are_refused(tools):
    result = await tools["schedule_ride"].func(
        title="x", arrive_by=(now() - timedelta(hours=1)).isoformat(), place_name="x",
        place_address="x",
    )
    assert result.startswith("Error")


async def test_tools_only_reach_the_riders_own_trips(trip, store, tools, trip_request):
    other = Trip(**{**trip_request.model_dump(), "rider_id": "someone_else"})
    store.put_trip(other)
    result = await tools["update_permissions"].func(trip_id=other.id, max_calls=9)
    assert result.startswith("Error")
    assert store.get_trip(other.id).permissions.max_calls == 3


async def test_message_appointment_respects_permissions(trip, store, tools):
    store.update_trip(trip.id, lambda t: setattr(t.permissions, "may_call_appointment", False))
    assert (await tools["message_appointment"].func(trip_id=trip.id, message="hi")).startswith(
        "Not allowed"
    )
    store.update_trip(trip.id, lambda t: setattr(t.permissions, "may_call_appointment", True))
    store.update_trip(trip.id, lambda t: setattr(t, "calls_used", t.permissions.max_calls))
    assert (await tools["message_appointment"].func(trip_id=trip.id, message="hi")).startswith(
        "Not allowed"
    )


async def test_booking_only_accepts_scored_times(planned, store, tools):
    odd = planned.plan.recommended.pickup_time + timedelta(minutes=2)
    result = await tools["book_pickup"].func(trip_id=planned.id, pickup_time=odd.isoformat())
    assert result.startswith("Error")
    pickup = planned.plan.recommended.pickup_time.isoformat()
    assert (await tools["book_pickup"].func(trip_id=planned.id, pickup_time=pickup)).startswith(
        "Booked"
    )
    assert store.get_trip(planned.id).status == TripStatus.booked


async def test_moving_the_appointment_before_pickup_replans(planned, store, tools, plans_started):
    pickup = planned.plan.recommended.pickup_time.isoformat()
    await tools["book_pickup"].func(trip_id=planned.id, pickup_time=pickup)
    new_time = (planned.arrive_by + timedelta(minutes=90)).replace(tzinfo=None).isoformat()
    await tools["change_appointment_time"].func(trip_id=planned.id, new_time=new_time)
    await asyncio.sleep(0)  # let the spawned planner start

    t = store.get_trip(planned.id)
    assert t.arrive_by == planned.arrive_by + timedelta(minutes=90)
    assert t.status == TripStatus.planning and t.booked_pickup is None
    assert plans_started == [planned.id]


async def test_permissions_change_only_given_fields(trip, store, tools):
    await tools["update_permissions"].func(trip_id=trip.id, max_calls=1)
    p = store.get_trip(trip.id).permissions
    assert p.max_calls == 1 and p.may_call_appointment is True


def test_trip_notices_go_to_the_riders_conversation(trip, store, rider):
    notify_rider(trip.id, "Your plan is ready.")
    assert [m.text for m in store.messages(rider.id)] == ["Your plan is ready."]
    assert store.messages(trip.id) == []


async def test_new_messages_are_published(rider, store):
    queue = bus.subscribe(rider.id)
    store.add_message(ChatMessage(thread_id=rider.id, sender="agent", kind="notice", text="hello"))
    kind, data = queue.get_nowait()
    assert kind == "messages" and '"hello"' in data
    bus.unsubscribe(rider.id, queue)


@pytest.fixture
def echo_agent(monkeypatch):
    async def fake_turn(thread_id, tag, text, kind):
        return chat.get_store().add_message(
            ChatMessage(thread_id=thread_id, sender="agent", text=f"{tag}: {text}")
        )

    monkeypatch.setattr(chat, "_turn", fake_turn)


def test_rider_chat_returns_rider_and_agent_messages(rider, echo_agent):
    with TestClient(app) as client:
        r = client.post(f"/riders/{rider.id}/messages", json={"text": "what's coming up?"})
        assert [m["sender"] for m in r.json()] == ["rider", "agent"]
        thread = client.get(f"/riders/{rider.id}/messages").json()
        assert thread[-1]["text"] == "rider_message: what's coming up?"


def test_trip_chat_uses_the_riders_conversation(trip, rider, echo_agent):
    with TestClient(app) as client:
        client.post(f"/trips/{trip.id}/messages", json={"text": "hi"})
        assert len(client.get(f"/riders/{rider.id}/messages").json()) == 2


def test_voice_turn_transcribes_then_answers(rider, echo_agent, monkeypatch):
    heard = []

    async def fake_transcribe(audio, filename, content_type):
        heard.append((audio, content_type))
        return "When is my next ride?"

    monkeypatch.setattr(riders.speech, "transcribe", fake_transcribe)
    with TestClient(app) as client:
        r = client.post(f"/riders/{rider.id}/voice",
                        files={"audio": ("talk.webm", b"\x1a\x45", "audio/webm")})
    body = r.json()
    assert heard == [(b"\x1a\x45", "audio/webm")]
    assert body["transcript"] == "When is my next ride?"
    assert body["messages"][-1]["text"] == "rider_voice: When is my next ride?"


def test_silence_gets_no_reply(rider, echo_agent, monkeypatch):
    async def fake_transcribe(audio, filename, content_type):
        return ""

    monkeypatch.setattr(riders.speech, "transcribe", fake_transcribe)
    with TestClient(app) as client:
        r = client.post(f"/riders/{rider.id}/voice",
                        files={"audio": ("a.webm", b"x", "audio/webm")})
    assert r.json() == {"transcript": "", "messages": []}


def test_speech_returns_mp3(monkeypatch):
    async def fake_synthesize(text):
        return b"ID3" + text.encode()

    monkeypatch.setattr(riders.speech, "synthesize", fake_synthesize)
    with TestClient(app) as client:
        r = client.post("/speech", json={"text": "hello"})
    assert r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3hello"


def test_api_key_can_be_a_query_parameter(rider, settings, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "k")
    with TestClient(app) as client:
        assert client.get(f"/riders/{rider.id}/messages").status_code == 401
        assert client.get(f"/riders/{rider.id}/messages?api_key=k").status_code == 200


def test_markdown_is_stripped_from_replies():
    text = "Be ready by **1:20 PM**.\n- bring ID\n## Next"
    assert chat.plain_text(text) == "Be ready by 1:20 PM.\nbring ID\nNext"


async def test_local_times_use_the_riders_time_zone(rider, store, tools, plans_started):
    from zoneinfo import ZoneInfo

    store.put_rider(rider.model_copy(update={"time_zone": "America/Los_Angeles"}))
    la = ZoneInfo("America/Los_Angeles")
    local = (now().astimezone(la) + timedelta(days=3)).replace(hour=15, minute=0, second=0,
                                                              microsecond=0, tzinfo=None)
    await tools["schedule_ride"].func(title="Dentist", arrive_by=local.isoformat(),
                                      place_name="Smile Dental", place_address="1 Main St")
    (trip,) = [t for t in store.rider_trips(rider.id) if t.title == "Dentist"]
    assert trip.arrive_by == local.replace(tzinfo=la)
