"""SQLite persistence. Each record is stored as a JSON document."""

import json
import sqlite3
import threading
from collections.abc import Callable
from typing import TypeVar

from pydantic import BaseModel

from . import bus
from .config import get_settings
from .schemas import ChatMessage, Event, Trip, VoiceTask

M = TypeVar("M", bound=BaseModel)

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection, id)
);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_trip ON events (trip_id, at);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_trip ON messages (trip_id, at);
"""


class Store:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.RLock()
        self._db.executescript(SCHEMA)

    def _get_raw(self, collection: str, id: str) -> str | None:
        with self._lock:
            row = self._db.execute(
                "SELECT data FROM docs WHERE collection = ? AND id = ?", (collection, id)
            ).fetchone()
        return row[0] if row else None

    def _put_raw(self, collection: str, id: str, data: str) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO docs (collection, id, data) VALUES (?, ?, ?)",
                (collection, id, data),
            )
            self._db.commit()

    def _get(self, collection: str, id: str, model: type[M]) -> M | None:
        raw = self._get_raw(collection, id)
        return model.model_validate_json(raw) if raw else None

    def _all(self, collection: str, model: type[M]) -> list[M]:
        with self._lock:
            rows = self._db.execute(
                "SELECT data FROM docs WHERE collection = ?", (collection,)
            ).fetchall()
        return [model.model_validate_json(r[0]) for r in rows]

    # trips

    def get_trip(self, trip_id: str) -> Trip | None:
        return self._get("trips", trip_id, Trip)

    def put_trip(self, trip: Trip) -> None:
        self._put_raw("trips", trip.id, trip.model_dump_json())

    def update_trip(self, trip_id: str, change: Callable[[Trip], None]) -> Trip:
        """Apply change to the latest stored version, so concurrent writers don't clobber."""
        with self._lock:
            trip = self.get_trip(trip_id)
            if trip is None:
                raise KeyError(trip_id)
            change(trip)
            self.put_trip(trip)
            return trip

    def all_trips(self) -> list[Trip]:
        return self._all("trips", Trip)

    # voice tasks

    def get_voice_task(self, task_id: str) -> VoiceTask | None:
        return self._get("voice_tasks", task_id, VoiceTask)

    def put_voice_task(self, task: VoiceTask) -> None:
        self._put_raw("voice_tasks", task.id, task.model_dump_json())

    # free-form JSON, e.g. the delay model's priors and trip logs

    def get_json(self, key: str):
        raw = self._get_raw("json", key)
        return json.loads(raw) if raw else None

    def put_json(self, key: str, value) -> None:
        self._put_raw("json", key, json.dumps(value, default=str))

    # per-trip logs: the activity log and the rider's chat thread.
    # New entries are also published so the rider app can stream them.

    def _append(self, table: str, item: Event | ChatMessage) -> None:
        data = item.model_dump_json()
        with self._lock:
            self._db.execute(
                f"INSERT INTO {table} (id, trip_id, at, data) VALUES (?, ?, ?, ?)",
                (item.id, item.trip_id, item.at.isoformat(), data),
            )
            self._db.commit()
        bus.publish(item.trip_id, table, data)

    def _list(self, table: str, trip_id: str, model: type[M]) -> list[M]:
        with self._lock:
            rows = self._db.execute(
                f"SELECT data FROM {table} WHERE trip_id = ? ORDER BY at", (trip_id,)
            ).fetchall()
        return [model.model_validate_json(r[0]) for r in rows]

    def log(self, trip_id: str, kind: str, message: str, **data) -> Event:
        event = Event(trip_id=trip_id, kind=kind, message=message, data=data)
        self._append("events", event)
        return event

    def events(self, trip_id: str) -> list[Event]:
        return self._list("events", trip_id, Event)

    def add_message(self, message: ChatMessage) -> ChatMessage:
        self._append("messages", message)
        return message

    def messages(self, trip_id: str) -> list[ChatMessage]:
        return self._list("messages", trip_id, ChatMessage)


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(get_settings().database_path)
    return _store


def set_store(store: Store) -> None:
    global _store
    _store = store
