"""Fire-and-forget background work that outlives the HTTP request."""

import asyncio
import logging
from collections.abc import Coroutine

log = logging.getLogger(__name__)
_running: set[asyncio.Task] = set()


def spawn(coro: Coroutine, name: str) -> asyncio.Task:
    task = asyncio.create_task(coro, name=name)
    _running.add(task)  # keep a reference so the task isn't garbage collected
    task.add_done_callback(_done)
    return task


def _done(task: asyncio.Task) -> None:
    _running.discard(task)
    if not task.cancelled() and task.exception():
        log.error("background job %s failed", task.get_name(), exc_info=task.exception())
