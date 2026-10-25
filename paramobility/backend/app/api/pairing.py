"""Pairing a phone with the dashboard's presentation, by a short code.

The dashboard (with the API key) asks for a code for the presentation's rider; the phone opens the
rider app with that code (a small QR, or typed in) and trades it for the rider id and the key.
A code is six digits and lasts ten minutes; wrong guesses are limited, like the call PIN
(app.voice.numbers), so a code can't be found by trying them all.
"""

import secrets
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.trips import require_api_key
from app.core.config import get_settings
from app.core.store import get_store

CODE_TTL = 600  # seconds a code is good for
GUESSES = 20  # wrong codes allowed per window, from anyone
GUESS_WINDOW = 600

_wrong: list[float] = []  # times of wrong codes, in this process

router = APIRouter(prefix="/pairing")


class PairIn(BaseModel):
    rider_id: str


@router.post("", dependencies=[Depends(require_api_key)])
def new_code(body: PairIn) -> dict:
    """A code that pairs a phone as this rider."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    get_store().put_json(
        f"pairing:{code}", {"rider_id": body.rider_id, "expires": time.time() + CODE_TTL}
    )
    return {"code": code, "expires_in": CODE_TTL}


@router.post("/{code}")
def claim(code: str) -> dict:
    """The rider id and the API key, for a phone with a valid code (no key needed: that's why)."""
    now = time.time()
    _wrong[:] = [t for t in _wrong if now - t < GUESS_WINDOW]
    if len(_wrong) >= GUESSES:
        raise HTTPException(429, "Too many wrong codes. Try again in a few minutes.")
    entry = get_store().get_json(f"pairing:{code}") if code.isdigit() and len(code) == 6 else None
    if not entry or entry["expires"] < now:
        _wrong.append(now)
        raise HTTPException(
            404, "That code isn't valid (codes last 10 minutes). Show a new one on the dashboard."
        )
    return {"rider_id": entry["rider_id"], "api_key": get_settings().api_key}
