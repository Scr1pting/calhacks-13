"""Runtime settings, read from the environment or a .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent.parent


class Settings(BaseSettings):
    # Later files win, so backend/.env overrides the repo-root .env.
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"), extra="ignore"
    )

    api_key: str = ""
    cors_origins: str = "*"  # comma-separated
    public_base_url: str = "http://localhost:8000"
    database_path: str = "./paramobility.db"

    # Drive times for app.prediction.routing: Google (traffic-aware) first, else OpenRouteService.
    google_maps_key: str = ""
    ors_api_key: str = ""
    drive_cache_path: str = "./drive_cache.json"  # temporary cache (Google's terms), git-ignored
    demo_cache: bool = False  # record live/route answers once and replay them (demos)
    demo_cache_path: str = "./demo_cache.json"

    anthropic_api_key: str = ""
    planner_model: str = "claude-sonnet-5-5"
    extract_model: str = "claude-haiku-5-5"

    cartesia_api_key: str = ""
    cartesia_api_base: str = "https://api.cartesia.ai"
    cartesia_version: str = "2026-08-14"
    cartesia_from_number_id: str = ""
    cartesia_policy_agent_id: str = ""
    cartesia_late_agent_id: str = ""
    cartesia_message_agent_id: str = ""
    chat_model: str = "claude-haiku-5-5"
    tts_model: str = "sonic-3.6"
    # Leeway's voice in the app; the same one the phone agents use.
    cartesia_voice_id: str = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"
    voice_webhook_secret: str = ""
    call_timeout_seconds: int = 600

    monitor_interval_seconds: int = 60
    # A trip counts as running late once P(arrive by deadline) drops below this.
    late_trigger_p: float = 0.5
    # Send a follow-up notice only when the delay grows by at least this much.
    renotify_minutes: int = 10

    @property
    def voice_enabled(self) -> bool:
        return bool(self.cartesia_api_key and self.cartesia_from_number_id)


@lru_cache
def get_settings() -> Settings:
    return Settings()
