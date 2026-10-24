"""Speech for talking to Leeway in the app: Cartesia speech-to-text and text-to-speech."""

import httpx

from app.core.config import get_settings


class SpeechError(RuntimeError):
    pass


def _headers() -> dict:
    s = get_settings()
    return {"Authorization": f"Bearer {s.cartesia_api_key}", "Cartesia-Version": s.cartesia_version}


async def transcribe(audio: bytes, filename: str, content_type: str) -> str:
    """Turn a recording (webm, ogg, mp4, wav, ...) into text."""
    s = get_settings()
    async with httpx.AsyncClient(base_url=s.cartesia_api_base, timeout=60) as http:
        r = await http.post(
            "/stt",
            headers=_headers(),
            data={"model": "ink-whisper", "language": "en"},
            files={"file": (filename, audio, content_type)},
        )
    if r.is_error:
        raise SpeechError(f"transcription failed: {r.status_code} {r.text}")
    return r.json()["text"].strip()


async def synthesize(text: str) -> bytes:
    """Speak text in Leeway's voice, as MP3."""
    s = get_settings()
    async with httpx.AsyncClient(base_url=s.cartesia_api_base, timeout=60) as http:
        r = await http.post(
            "/tts/bytes",
            headers=_headers(),
            json={
                "model_id": s.tts_model,
                "transcript": text,
                "voice": {"id": s.cartesia_voice_id},
                "language": "en",
                "output_format": {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000},
            },
        )
    if r.is_error:
        raise SpeechError(f"speech synthesis failed: {r.status_code} {r.text}")
    return r.content
