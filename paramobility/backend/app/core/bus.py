"""In-process pub/sub so the rider app can stream a trip's messages and activity."""

import asyncio
from collections import defaultdict

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(trip_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers[trip_id].add(queue)
    return queue


def unsubscribe(trip_id: str, queue: asyncio.Queue) -> None:
    _subscribers[trip_id].discard(queue)
    if not _subscribers[trip_id]:
        del _subscribers[trip_id]


def publish(trip_id: str, event: str, data: str) -> None:
    """data is already-serialized JSON. Slow subscribers miss events rather than block."""
    for queue in _subscribers.get(trip_id, ()):
        if not queue.full():
            queue.put_nowait((event, data))
