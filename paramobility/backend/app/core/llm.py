"""Shared Anthropic client and request defaults."""

from functools import lru_cache

from anthropic import AsyncAnthropic

from .config import get_settings

# Server-side fallback reruns a refused request on another model inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


@lru_cache
def get_client() -> AsyncAnthropic:
    # Falls back to the SDK's own lookup (ANTHROPIC_API_KEY env var, ant profile) when unset.
    return AsyncAnthropic(api_key=get_settings().anthropic_api_key or None)


def final_text(message) -> str:
    return "".join(b.text for b in message.content if b.type == "text").strip()
