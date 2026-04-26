"""Wrapper around the Anthropic SDK for Buddy's chat and robot skills.

Uses prompt caching on the long, stable system prompts (saves ~90% on repeat calls)
and structured outputs to guarantee valid JSON for robot actions.
"""

from __future__ import annotations

import json
import os
from typing import Optional

import anthropic

from . import config, demo_mode


class BuddyBrain:
    def __init__(self, api_key: Optional[str] = None):
        self._chat_history: list[dict] = []
        self._client = None
        self._init_error = None

        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            self._init_error = "Demo mode: no API key set. Buddy is using a tiny offline brain."
            return
        try:
            self._client = anthropic.Anthropic(api_key=key)
        except Exception as e:
            self._init_error = f"Demo mode: could not connect to Anthropic ({e})"

    @property
    def ready(self) -> bool:
        return self._client is not None

    @property
    def demo_mode(self) -> bool:
        return self._client is None

    @property
    def init_error(self) -> Optional[str]:
        return self._init_error

    def reset_chat(self) -> None:
        self._chat_history = []

    def chat(self, user_message: str) -> dict:
        if not self._client:
            return {"ok": True, "text": demo_mode.chat_reply(user_message), "demo": True}

        self._chat_history.append({"role": "user", "content": user_message})

        try:
            response = self._client.messages.create(
                model=config.CHAT_MODEL,
                max_tokens=512,
                system=[
                    {
                        "type": "text",
                        "text": config.BUDDY_CHAT_SYSTEM,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=self._chat_history,
            )
        except anthropic.APIError as e:
            self._chat_history.pop()
            return {"ok": False, "error": f"API error: {e}"}
        except Exception as e:
            self._chat_history.pop()
            return {"ok": False, "error": f"Something went wrong: {e}"}

        text = next((b.text for b in response.content if b.type == "text"), "")
        self._chat_history.append({"role": "assistant", "content": text})

        if len(self._chat_history) > 40:
            self._chat_history = self._chat_history[-30:]

        return {"ok": True, "text": text}

    def plan_robot(self, user_message: str) -> dict:
        if not self._client:
            plan = demo_mode.robot_plan(user_message)
            plan = self._sanitize_plan(plan)
            return {"ok": True, "plan": plan, "demo": True}

        try:
            response = self._client.messages.create(
                model=config.ROBOT_MODEL,
                max_tokens=512,
                system=[
                    {
                        "type": "text",
                        "text": config.BUDDY_ROBOT_SYSTEM,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_message}],
                output_config={
                    "format": {
                        "type": "json_schema",
                        "schema": config.ROBOT_OUTPUT_SCHEMA,
                    }
                },
            )
        except anthropic.APIError as e:
            return {"ok": False, "error": f"API error: {e}"}
        except Exception as e:
            return {"ok": False, "error": f"Something went wrong: {e}"}

        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            plan = json.loads(text)
        except json.JSONDecodeError:
            return {"ok": False, "error": "Buddy got tongue-tied. Try saying it again?"}

        plan = self._sanitize_plan(plan)
        return {"ok": True, "plan": plan}

    def _sanitize_plan(self, plan: dict) -> dict:
        actions = plan.get("actions", []) or []
        cleaned = []
        total = 0.0
        for a in actions:
            name = a.get("action")
            if name not in ("forward", "backward", "turn_left", "turn_right", "stop"):
                continue
            entry = {"action": name}
            if name != "stop":
                secs = float(a.get("seconds", 0) or 0)
                secs = max(0.5, min(config.MAX_SINGLE_ACTION_SECONDS, secs))
                if total + secs > config.MAX_TOTAL_SECONDS:
                    secs = max(0.0, config.MAX_TOTAL_SECONDS - total)
                if secs <= 0:
                    break
                entry["seconds"] = secs
                total += secs
            cleaned.append(entry)
        return {
            "actions": cleaned,
            "narration": plan.get("narration") or "Woof!",
        }
