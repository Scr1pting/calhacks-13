"""In-process pub/sub so the rider app can stream a trip's messages and activity."""

import asyncio
from collections import defaultdict

# Each subscriber's queue, with the event loop that reads it.
_subscribers: dict[str, dict[asyncio.Queue, asyncio.AbstractEventLoop]] = defaultdict(dict)


def subscribe(trip_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers[trip_id][queue] = asyncio.get_running_loop()
    return queue


def unsubscribe(trip_id: str, queue: asyncio.Queue) -> None:
    _subscribers[trip_id].pop(queue, None)
    if not _subscribers[trip_id]:
        del _subscribers[trip_id]


def publish(trip_id: str, event: str, data: str) -> None:
    """data is already-serialized JSON. Slow subscribers miss events rather than block.

    Safe from any thread: from a worker thread (a sync endpoint, asyncio.to_thread), the event
    is handed to the subscriber's loop, so its stream wakes up at once.
    """
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    for queue, loop in list(_subscribers.get(trip_id, {}).items()):
        if loop is running:
            _offer(queue, (event, data))
        else:
            try:
                loop.call_soon_threadsafe(_offer, queue, (event, data))
            except RuntimeError:  # that subscriber's loop is gone
                unsubscribe(trip_id, queue)


def _offer(queue: asyncio.Queue, item: tuple[str, str]) -> None:
    if not queue.full():
        queue.put_nowait(item)
