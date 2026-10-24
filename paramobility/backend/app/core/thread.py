"""The rider's conversation thread: agents post notices here for the rider to see."""

from .schemas import ChatMessage
from .store import get_store


def notify_rider(trip_id: str, text: str) -> ChatMessage:
    return get_store().add_message(
        ChatMessage(trip_id=trip_id, sender="agent", kind="notice", text=text)
    )
