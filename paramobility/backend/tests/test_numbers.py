import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tools import actions
from app.voice import numbers


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def pin(settings, monkeypatch):
    monkeypatch.setattr(settings, "call_pin", "2468")
    numbers._pin_failures.clear()
    return "2468"


@pytest.mark.parametrize(
    "raw", ["(415) 555-0123", "415.555.0123", "+1 415 555 0123", "14155550123"]
)
def test_numbers_are_normalized(raw):
    assert numbers.normalize(raw) == "+14155550123"


@pytest.mark.parametrize(
    "raw", ["911", "+44 20 7946 0958", "(115) 555-0123", "(415) 155-0123", "(411) 555-0123"]
)
def test_invalid_numbers_are_rejected(raw):
    with pytest.raises(numbers.NumberRejected):
        numbers.normalize(raw)


@pytest.mark.parametrize("raw", ["(510) 287-5000", "(900) 555-0123"])
def test_agency_and_premium_lines_are_never_callable(raw, pin):
    with pytest.raises(numbers.NumberRejected):
        numbers.approve(raw, pin)


def test_a_number_needs_the_pin(pin):
    with pytest.raises(numbers.PinRejected):
        numbers.approve("(415) 555-0123", "0000")
    assert "+14155550123" not in numbers.approved_numbers()
    assert numbers.approve("(415) 555-0123", pin) == "+14155550123"
    assert numbers.authorize_call("415-555-0123") == "+14155550123"


def test_adding_is_off_without_a_server_pin():
    with pytest.raises(numbers.PinRejected):
        numbers.approve("(415) 555-0123", "")


def test_wrong_pins_are_limited(pin):
    for _ in range(numbers.PIN_ATTEMPTS):
        with pytest.raises(numbers.PinRejected):
            numbers.approve("(415) 555-0123", "0000")
    with pytest.raises(numbers.PinRejected, match="Too many"):
        numbers.approve("(415) 555-0123", pin)


def test_calls_per_number_are_limited(settings, monkeypatch):
    monkeypatch.setattr(settings, "call_allowlist", "+14155550123")
    monkeypatch.setattr(settings, "call_limit_per_hour", 2)
    for _ in range(2):
        numbers.record_call(numbers.authorize_call("+14155550123"))
    with pytest.raises(numbers.NumberRejected, match="this hour"):
        numbers.authorize_call("+14155550123")


def test_a_refused_number_costs_no_call_from_the_budget(trip, store):
    with pytest.raises(actions.NotAllowed, match="approved"):
        actions._take_call(trip.id)
    assert store.get_trip(trip.id).calls_used == 0


def test_the_api_checks_and_adds_numbers(client, pin):
    def post(path, phone, pin=""):
        return client.post(path, json={"phone": phone, "pin": pin})

    r = post("/call-numbers/check", "(415) 555-0123")
    assert (r.json()["phone"], r.json()["approved"]) == ("+14155550123", False)
    assert post("/call-numbers", "(415) 555-0123", "1111").status_code == 403
    assert post("/call-numbers", "(510) 287-5000", pin).status_code == 422
    assert post("/call-numbers", "(415) 555-0123", pin).json()["approved"] is True
    assert post("/call-numbers/check", "415-555-0123").json()["approved"] is True
