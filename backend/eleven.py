"""ElevenLabs Text-to-Speech client.

Wraps the v1 TTS API and the voices listing endpoint. Handles missing keys
and errors gracefully so the rest of the app can fall back to the browser's
Web Speech API without crashing.

Sign up at https://elevenlabs.io and set:
    setx ELEVENLABS_API_KEY "your-key-here"
then restart the app.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx


# Default voice: Charlotte — warm, conversational young female. Suits Biscuit.
# Scott can swap via the settings modal once ElevenLabs is configured.
DEFAULT_VOICE_ID = "XB0fDUnXU5powFXDhCwa"  # Charlotte

# Curated voice options to surface in the settings UI without a full API roundtrip
CURATED_VOICES: list[dict] = [
    {"id": "XB0fDUnXU5powFXDhCwa", "name": "Charlotte", "blurb": "Warm conversational (default)"},
    {"id": "9BWtsMINqrJLrRacOk9x", "name": "Aria",      "blurb": "Young friendly female"},
    {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah",     "blurb": "Soft warm female"},
    {"id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel",    "blurb": "Calm storyteller female"},
    {"id": "AZnzlk1XvdvUeBnXmlld", "name": "Domi",      "blurb": "Energetic young female"},
    {"id": "pNInz6obpgDQGcFmaJgB", "name": "Adam",      "blurb": "Friendly male"},
    {"id": "TX3LPaxmHKxFdv7VOQHJ", "name": "Liam",      "blurb": "Young energetic male"},
]

# Eleven Turbo v2.5: fast, cheap, high quality. Great for an interactive kid app.
DEFAULT_MODEL_ID = "eleven_turbo_v2_5"


class ElevenLabs:
    def __init__(self) -> None:
        key = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
        self._key: Optional[str] = key or None
        self._client = httpx.Client(timeout=30.0)
        self._init_error: Optional[str] = None
        if not self._key:
            self._init_error = "ELEVENLABS_API_KEY not set"

    @property
    def ready(self) -> bool:
        return self._key is not None

    @property
    def init_error(self) -> Optional[str]:
        return self._init_error

    def synthesize(
        self,
        text: str,
        voice_id: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> bytes:
        """Synthesize text to MP3 audio bytes. Raises RuntimeError on failure
        so the caller can fall back to Web Speech."""
        if not self._key:
            raise RuntimeError("ELEVENLABS_API_KEY not set")
        if not text or not text.strip():
            raise ValueError("Empty text")

        voice = voice_id or DEFAULT_VOICE_ID
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
        headers = {
            "xi-api-key": self._key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": text,
            "model_id": model_id or DEFAULT_MODEL_ID,
            "voice_settings": {
                "stability": 0.45,        # lower = more emotional variation
                "similarity_boost": 0.75,
                "style": 0.40,            # mild style exaggeration for warmth
                "use_speaker_boost": True,
            },
        }

        try:
            resp = self._client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as e:
            raise RuntimeError(f"network: {e}") from e

        if resp.status_code == 401:
            raise RuntimeError("Invalid ELEVENLABS_API_KEY")
        if resp.status_code == 429:
            raise RuntimeError("ElevenLabs rate limit hit")
        if resp.status_code >= 400:
            raise RuntimeError(f"ElevenLabs API {resp.status_code}: {resp.text[:200]}")

        return resp.content

    def list_voices(self) -> list[dict]:
        """Return the curated quick-pick list. (We could fetch live via /v1/voices
        but that requires the key and is slow on cold start; the curated list
        covers the most useful production voices.)"""
        return CURATED_VOICES

    def usage(self) -> Optional[dict]:
        """Returns the user's subscription / character-count info, or None."""
        if not self._key:
            return None
        try:
            resp = self._client.get(
                "https://api.elevenlabs.io/v1/user/subscription",
                headers={"xi-api-key": self._key},
                timeout=10.0,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            return {
                "characters_used": data.get("character_count"),
                "characters_limit": data.get("character_limit"),
                "tier": data.get("tier"),
            }
        except Exception:
            return None
