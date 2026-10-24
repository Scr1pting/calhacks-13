"""Conversation threads: one per rider, or per trip for trips without a rider."""

from .schemas import ChatMessage, Trip
from .store import get_store


def thread_of(trip: Trip) -> str:
    return trip.rider_id or trip.id


def notify_rider(trip_id: str, text: str) -> ChatMessage:
    """Post a notice about a trip where the rider will see it."""
    store = get_store()
    trip = store.get_trip(trip_id)
    return post_notice(thread_of(trip) if trip else trip_id, text)


def post_notice(thread_id: str, text: str) -> ChatMessage:
    return get_store().add_message(
        ChatMessage(thread_id=thread_id, sender="agent", kind="notice", text=text)
    )
