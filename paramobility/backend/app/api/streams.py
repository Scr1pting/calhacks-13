"""Server-sent events for the rider app."""

import asyncio
from collections.abc import Callable

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.core import bus


def sse(request: Request, key: str, backlog: Callable[[], list[str]] | None = None) -> StreamingResponse:
    """Stream everything published under key (a trip or rider id) until the client leaves.

    `backlog`, if given, is called right after subscribing and its JSON strings are
    replayed as `events` before the live stream starts. Without it, a subscriber that
    connects after something already finished — e.g. a trip planned near-instantly,
    before the rider app's EventSource had time to open — would miss it for good:
    pub/sub here has no replay of its own, and the event only fires once.
    """
    queue = bus.subscribe(key)

    async def events():
        try:
            yield ": connected\n\n"
            for data in backlog() if backlog else ():
                yield f"event: events\ndata: {data}\n\n"
            while not await request.is_disconnected():
                try:
                    kind, data = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: {kind}\ndata: {data}\n\n"
        finally:
            bus.unsubscribe(key, queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
