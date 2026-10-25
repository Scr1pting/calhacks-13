"""Which phone numbers Leeway may call, and how often.

The rider app can name the number a demo call goes to, and its API key ships
in the browser, so every call is checked here, on the server, before it is
dialled (whatever path it came from: the app, the chat agent, the monitor):

- it must be a valid US/Canada number (E.164, +1 and ten digits) and not a
  premium-rate, emergency or real paratransit agency line (the team rule:
  never call real agency lines), nor Leeway's own number;
- it must be approved: listed in CALL_ALLOWLIST, or added through the app
  with the CALL_PIN set on the server;
- and it must not have been called too often lately.
"""

import hmac
import re
import time

from app.core.config import get_settings
from app.core.store import get_store

APPROVED_KEY = "call_numbers:approved"
CALLS_KEY = "call_numbers:calls"
HOUR = 3600
DAY = 24 * HOUR

# Real agency lines, never to be dialled: East Bay Paratransit reservations and
# ETA line, SF Access "Where's My Ride". (Add more as the demo covers them.)
AGENCY_LINES = {"+15102875000", "+14152856945"}
# Area and exchange codes that are premium-rate or not for ordinary calls.
BLOCKED_AREA_CODES = {"900", "976"}

# Failed PIN attempts, in this process: a few per 10 minutes, then a pause.
_pin_failures: list[float] = []
PIN_ATTEMPTS = 5
PIN_WINDOW = 600


class NumberRejected(Exception):
    """The number can't be called. The message says why, for the rider."""


class PinRejected(NumberRejected):
    """Adding a number was refused: no PIN on the server, a wrong one, or too many tries."""


def normalize(raw: str) -> str:
    """A US/Canada number in E.164 (+1XXXXXXXXXX), from however it was typed."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) != 11 or not digits.startswith("1"):
        raise NumberRejected("Enter a US or Canadian number, like (415) 555-0123.")
    area, exchange = digits[1:4], digits[4:7]
    if area[0] in "01" or exchange[0] in "01" or area[1:] == "11" or exchange[1:] == "11":
        raise NumberRejected("That isn't a valid US or Canadian number.")
    return "+" + digits


def check(raw: str) -> str:
    """The normalized number, if it is one Leeway could ever call."""
    number = normalize(raw)
    settings = get_settings()
    if number[2:5] in BLOCKED_AREA_CODES:
        raise NumberRejected("Premium-rate numbers can't be called.")
    if number in AGENCY_LINES:
        raise NumberRejected("Leeway never calls real paratransit agency lines.")
    own = settings.cartesia_from_number_id
    if own.startswith("+") and normalize(own) == number:
        raise NumberRejected("That is Leeway's own number.")
    return number


def approved_numbers() -> set[str]:
    allow = {normalize(n) for n in get_settings().call_allowlist.split(",") if n.strip()}
    return allow | set(get_store().get_json(APPROVED_KEY) or [])


def approve(raw: str, pin: str) -> str:
    """Add a number through the app. Needs the server's CALL_PIN."""
    number = check(raw)
    expected = get_settings().call_pin
    if not expected:
        raise PinRejected("Adding numbers is turned off on this server (no CALL_PIN set).")
    now = time.time()
    _pin_failures[:] = [t for t in _pin_failures if now - t < PIN_WINDOW]
    if len(_pin_failures) >= PIN_ATTEMPTS:
        raise PinRejected("Too many wrong PINs. Try again in a few minutes.")
    if not hmac.compare_digest(pin.encode(), expected.encode()):
        _pin_failures.append(now)
        raise PinRejected("That PIN isn't right.")
    store = get_store()
    store.put_json(APPROVED_KEY, sorted(set(store.get_json(APPROVED_KEY) or []) | {number}))
    return number


def authorize_call(raw: str) -> str:
    """The number to dial, or NumberRejected. Call record_call once it is placed."""
    number = check(raw)
    if number not in approved_numbers():
        raise NumberRejected(f"{number} hasn't been approved for calls.")
    settings = get_settings()
    now = time.time()
    recent = [t for t in (get_store().get_json(CALLS_KEY) or {}).get(number, []) if now - t < DAY]
    if sum(1 for t in recent if now - t < HOUR) >= settings.call_limit_per_hour:
        raise NumberRejected(
            f"{number} has had {settings.call_limit_per_hour} calls this hour already."
        )
    if len(recent) >= settings.call_limit_per_day:
        raise NumberRejected(f"{number} has had {settings.call_limit_per_day} calls today already.")
    return number


def record_call(number: str) -> None:
    store = get_store()
    now = time.time()
    calls = store.get_json(CALLS_KEY) or {}
    calls[number] = [t for t in calls.get(number, []) if now - t < DAY] + [now]
    store.put_json(CALLS_KEY, calls)
