"""Local API key storage.

Lives at Documents/NicksRobotBuddy/secrets.json — outside the git repo so
keys never accidentally get committed. Lookup order is:

    env var → secrets.json → None

This way `setx ANTHROPIC_API_KEY` continues to work for users who prefer
that, but the in-app paste UI is the friendly path.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from .memory import app_data_root

SECRETS_PATH = app_data_root() / "secrets.json"

# Mapping from env-var name to JSON key. Add new keys here.
KEY_REGISTRY = {
    "ANTHROPIC_API_KEY":   "anthropic_api_key",
    "ELEVENLABS_API_KEY":  "elevenlabs_api_key",
}


class SecretsStore:
    def __init__(self) -> None:
        SECRETS_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._data: dict = self._load()

    def _load(self) -> dict:
        if SECRETS_PATH.exists():
            try:
                return json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    def get(self, name: str) -> Optional[str]:
        v = self._data.get(name)
        if isinstance(v, str) and v.strip():
            return v.strip()
        return None

    def set(self, name: str, value: str) -> None:
        if value and value.strip():
            self._data[name] = value.strip()
        else:
            self._data.pop(name, None)
        self._save()

    def _save(self) -> None:
        try:
            tmp = SECRETS_PATH.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
            tmp.replace(SECRETS_PATH)
        except Exception as e:
            print(f"[secrets] save failed: {e}")

    def status(self) -> dict:
        """Return {json_key: bool} indicating which keys are present."""
        return {jk: bool(self.get(jk)) for jk in KEY_REGISTRY.values()}


_singleton: Optional[SecretsStore] = None


def get_secrets() -> SecretsStore:
    global _singleton
    if _singleton is None:
        _singleton = SecretsStore()
    return _singleton


def resolve_key(env_var: str) -> Optional[str]:
    """Resolve an API key. Env var wins over the secrets file."""
    v = (os.environ.get(env_var) or "").strip()
    if v:
        return v
    json_key = KEY_REGISTRY.get(env_var)
    if not json_key:
        return None
    return get_secrets().get(json_key)
