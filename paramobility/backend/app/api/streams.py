"""Server-sent events for the rider app."""

import asyncio

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.core import bus


def sse(request: Request, key: str) -> StreamingResponse:
    """Stream everything published under key (a trip or rider id) until the client leaves."""
    queue = bus.subscribe(key)

    async def events():
        try:
            yield ": connected\n\n"
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
