import asyncio

import pytest

from app.core.schemas import VoiceTaskKind
from app.voice import calls


class FakeCartesia:
    """A call whose transcript grows over three polls, then ends."""

    hello = {"role": "assistant", "text": "Hi, calling for Maya."}
    reply = {"role": "user", "text": "Sure, go ahead."}
    polls = [
        {"status": "started", "transcript": [hello]},
        {"status": "started", "transcript": [hello, reply]},
        {"status": "completed", "summary": "ok",
         "transcript": [hello, reply, {"role": "system", "text": "tool call"}]},
    ]

    async def __aenter__(self):
        self.n = 0
        return self

    async def __aexit__(self, *exc):
        pass

    async def start_call(self, agent_id, to_number, variables):
        return "call_1"

    async def get_call(self, call_id):
        self.n += 1
        return self.polls[min(self.n, len(self.polls)) - 1]


@pytest.fixture
def voice(settings, monkeypatch):
    for name, value in [("cartesia_api_key", "k"), ("cartesia_from_number_id", "ap_1"),
                        ("cartesia_late_agent_id", "agent_1"), ("call_allowlist", "+14155550199")]:
        monkeypatch.setattr(settings, name, value)
    monkeypatch.setattr(calls, "CartesiaClient", FakeCartesia)
    monkeypatch.setattr(calls, "POLL_SECONDS", 1)

    async def no_sleep(_):
        pass

    monkeypatch.setattr(asyncio, "sleep", no_sleep)

    async def no_extraction(kind, transcript):
        return None

    monkeypatch.setattr(calls.extract, "from_transcript", no_extraction)


async def test_transcript_is_logged_as_the_call_goes(trip, store, voice):
    await calls.run_voice_task(trip, VoiceTaskKind.late_notice, {})
    events = store.events(trip.id)
    kinds = [e.kind for e in events]
    assert kinds == ["call_started", "call_progress", "call_progress", "call_ended"]
    assert events[0].data["call_kind"] == "late_notice"
    progress = [line for e in events[1:3] for line in e.data["lines"]]
    assert progress == [
        {"role": "agent", "text": "Hi, calling for Maya."},
        {"role": "callee", "text": "Sure, go ahead."},
    ]
    assert events[-1].data["transcript"] == progress  # system lines are left out


async def test_an_unapproved_number_is_never_dialled(trip, store, voice, settings, monkeypatch):
    monkeypatch.setattr(settings, "call_allowlist", "")
    task = await calls.run_voice_task(trip, VoiceTaskKind.late_notice, {})
    assert task.status == "blocked"
    assert [e.kind for e in store.events(trip.id)] == ["call_blocked"]


def test_a_report_for_another_backends_call_is_accepted():
    """The agents are shared, so a webhook can arrive for a task placed elsewhere."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        r = client.post("/voice/webhooks/policy", json={"task_id": "vt_elsewhere"},
                        headers={"Authorization": "Bearer test-secret"})
    assert r.status_code == 200
