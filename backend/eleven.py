"""ElevenLabs Text-to-Speech client.

Wraps the v1 TTS API and the voices listing endpoint. Handles missing keys
and errors gracefully so the rest of the app can fall back to the browser's
Web Speech API without crashing.

Sign up at https://elevenlabs.io and set:
    setx ELEVENLABS_API_KEY "your-key-here"
then restart the app.
"""

from __future__ import annotations

from typing import Optional

import httpx

from .secrets import resolve_key


# Default voice: Jessica — playful, bright, warm. Premade voice (free tier
# accessible). Best fit for a puppy persona out of the standard catalog.
DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"  # Jessica

# Curated voice options — all premade (free-tier accessible), no library voices
# which would require a paid plan. Picked for kid-app suitability.
CURATED_VOICES: list[dict] = [
    {"id": "cgSgspJ2msm6clMCkdW9", "name": "Jessica",   "blurb": "Playful, bright, warm (default)"},
    {"id": "FGY2WhTYpPnrIDTdsKH5", "name": "Laura",     "blurb": "Enthusiastic, quirky"},
    {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah",     "blurb": "Mature, reassuring"},
    {"id": "JBFqnCBsd6RMkjVDRZzb", "name": "George",    "blurb": "Warm storyteller"},
    {"id": "pFZP5JQG7iQjIQuC4Bku", "name": "Lily",      "blurb": "Velvety actress"},
    {"id": "hpp4J3VqNfWAUOO0d1Us", "name": "Bella",     "blurb": "Professional, bright, warm"},
    {"id": "TX3LPaxmHKxFdv7VOQHJ", "name": "Liam",      "blurb": "Energetic young male"},
    {"id": "iP95p4xoKVk53GoZ742B", "name": "Chris",     "blurb": "Charming, down-to-earth male"},
]

# Eleven Turbo v2.5: fast, cheap, high quality. Great for an interactive kid app.
DEFAULT_MODEL_ID = "eleven_turbo_v2_5"


class ElevenLabs:
    def __init__(self) -> None:
        # Env var first, then Documents/NicksRobotBuddy/secrets.json
        self._key: Optional[str] = resolve_key("ELEVENLABS_API_KEY")
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

    def _voice_settings(self) -> dict:
        return {
            "stability": 0.45,
            "similarity_boost": 0.75,
            "style": 0.40,
            "use_speaker_boost": True,
        }

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
            "voice_settings": self._voice_settings(),
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

    def synthesize_with_timestamps(
        self,
        text: str,
        voice_id: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> dict:
        """Returns {audio_b64: str, alignment: {...}} where alignment maps
        characters to playback times in seconds. Used to drive lip sync.

        Alignment shape:
            {
              "characters": ["H", "i", "!"...],
              "character_start_times_seconds": [0.0, 0.05, 0.12, ...],
              "character_end_times_seconds":   [0.04, 0.11, 0.19, ...],
            }
        """
        if not self._key:
            raise RuntimeError("ELEVENLABS_API_KEY not set")
        if not text or not text.strip():
            raise ValueError("Empty text")

        voice = voice_id or DEFAULT_VOICE_ID
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps"
        headers = {
            "xi-api-key": self._key,
            "Content-Type": "application/json",
        }
        payload = {
            "text": text,
            "model_id": model_id or DEFAULT_MODEL_ID,
            "voice_settings": self._voice_settings(),
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

        data = resp.json()
        # The API returns audio as base64. Some endpoint variants nest
        # alignment under "normalized_alignment" or "alignment" — accept either.
        alignment = data.get("alignment") or data.get("normalized_alignment") or {}
        return {
            "audio_b64": data.get("audio_base64", ""),
            "alignment": alignment,
        }

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
