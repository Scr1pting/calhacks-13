"""Save the presentation ride's timeline for the dashboard (dev only).

    python -m scripts.presentation_snapshot

Writes frontend/dashboard/public/data/presentation.json: the ride (GET /presentation) and what
the rider app shows at every point of it (GET /presentation/timeline). The dashboard's
presentation film uses it when no backend is set up, so it can be rehearsed offline. Re-run it
after re-exporting the ride (scripts/demo_ride.py).
"""

import json
from pathlib import Path

from app.demo import presentation

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
OUT = FRONTEND / "dashboard" / "public" / "data" / "presentation.json"


def main() -> None:
    points = presentation.timeline()
    OUT.write_text(
        json.dumps({"info": presentation.info(), "timeline": points}, separators=(",", ":"))
    )
    ask = next((p for p in points if p["ask"]), None)
    print(f"{len(points)} points -> {OUT}")
    asked = f"asks at {ask['t']}: {ask['ask']}" if ask else "never asks"
    print(f"{asked}; arrives {points[-1]['eta']}")


if __name__ == "__main__":
    main()
