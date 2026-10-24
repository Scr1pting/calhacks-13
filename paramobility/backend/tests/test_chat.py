import asyncio
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.agents import chat, planner
from app.core import bus
from app.core.schemas import ChatMessage, TripStatus
from app.main import app
from app.tools import model_tools


@pytest.fixture
def tools(trip):
    return {t.name: t for t in chat.build_tools(trip.id)}


@pytest.fixture
def planned(trip, store):
    """The trip with a plan from the fake model, as if the planner had run."""
    opts = model_tools.options(trip, trip.certainty)
    rows = model_tools.tradeoff(trip)

    def change(t):
        t.plan = planner.Plan(recommended=opts[0], options=opts, tradeoff=rows, explanation="ok")
        t.status = TripStatus.planned

    return store.update_trip(trip.id, change)


@pytest.fixture
def plans_started(monkeypatch):
    started = []

    async def fake_plan_trip(trip_id):
        started.append(trip_id)

    monkeypatch.setattr(planner, "plan_trip", fake_plan_trip)
    return started


async def test_message_appointment_respects_permissions(trip, store, tools):
    store.update_trip(trip.id, lambda t: setattr(t.permissions, "may_call_appointment", False))
    assert (await tools["message_appointment"].func(message="hi")).startswith("Not allowed")
    store.update_trip(trip.id, lambda t: setattr(t.permissions, "may_call_appointment", True))
    store.update_trip(trip.id, lambda t: setattr(t, "calls_used", t.permissions.max_calls))
    assert (await tools["message_appointment"].func(message="hi")).startswith("Not allowed")


async def test_booking_only_accepts_scored_times(planned, store, tools):
    odd = planned.plan.recommended.pickup_time + timedelta(minutes=2)
    assert (await tools["book_pickup"].func(pickup_time=odd.isoformat())).startswith("Error")
    pickup = planned.plan.recommended.pickup_time.isoformat()
    assert (await tools["book_pickup"].func(pickup_time=pickup)).startswith("Booked")
    assert store.get_trip(planned.id).status == TripStatus.booked


async def test_moving_the_appointment_before_pickup_replans(planned, store, tools, plans_started):
    await tools["book_pickup"].func(pickup_time=planned.plan.recommended.pickup_time.isoformat())
    new_time = (planned.arrive_by + timedelta(minutes=90)).replace(tzinfo=None).isoformat()
    await tools["change_appointment_time"].func(new_time=new_time)
    await asyncio.sleep(0)  # let the spawned planner start

    t = store.get_trip(planned.id)
    assert t.arrive_by == planned.arrive_by + timedelta(minutes=90)
    assert t.status == TripStatus.planning and t.booked_pickup is None
    assert plans_started == [planned.id]


async def test_permissions_change_only_given_fields(trip, store, tools):
    await tools["update_permissions"].func(max_calls=1)
    p = store.get_trip(trip.id).permissions
    assert p.max_calls == 1 and p.may_call_appointment is True


async def test_new_messages_are_published(trip, store):
    queue = bus.subscribe(trip.id)
    store.add_message(ChatMessage(trip_id=trip.id, sender="agent", kind="notice", text="hello"))
    kind, data = queue.get_nowait()
    assert kind == "messages" and '"hello"' in data
    bus.unsubscribe(trip.id, queue)


def test_chat_endpoint_returns_rider_and_agent_messages(trip, monkeypatch):
    async def fake_turn(trip_id, tag, text, kind):
        return chat.get_store().add_message(
            ChatMessage(trip_id=trip_id, sender="agent", text=f"you said {text}")
        )

    monkeypatch.setattr(chat, "_turn", fake_turn)
    with TestClient(app) as client:
        r = client.post(f"/trips/{trip.id}/messages", json={"text": "when is my pickup?"})
        assert [m["sender"] for m in r.json()] == ["rider", "agent"]
        thread = client.get(f"/trips/{trip.id}/messages").json()
        assert thread[-1]["text"] == "you said when is my pickup?"


def test_api_key_can_be_a_query_parameter(trip, settings, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "k")
    with TestClient(app) as client:
        assert client.get(f"/trips/{trip.id}/messages").status_code == 401
        assert client.get(f"/trips/{trip.id}/messages?api_key=k").status_code == 200


def test_markdown_is_stripped_from_replies():
    text = "Be ready by **1:20 PM**.\n- bring ID\n## Next"
    assert chat.plain_text(text) == "Be ready by 1:20 PM.\nbring ID\nNext"
