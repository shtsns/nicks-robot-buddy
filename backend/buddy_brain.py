"""Wrapper around the Anthropic SDK for Buddy's many skills.

Each skill has its own conversation history so 20 Questions doesn't bleed into
Story Time. Demo mode (no API key) falls back to a phrasebook for plain chat
and a polite "ask a grown-up to set up the API key" for the games.
"""

from __future__ import annotations

import json
import os
from typing import Optional

import anthropic

from . import config, demo_mode
from .memory import Memory


DEMO_GAME_REPLY = (
    "*tilts head* Buddy's smart brain isn't on yet for this game! "
    "Ask a grown-up to set up the API key, then we can play. "
    "Want to talk to me instead? Hit the back button!"
)


class BuddyBrain:
    def __init__(self, api_key: Optional[str] = None):
        # skill_id -> list of {role, content} dicts
        self._histories: dict[str, list[dict]] = {}
        self._client = None
        self._init_error = None
        self.memory = Memory()

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

    # ---------- internals ----------

    def _build_system_prompt(self, base_prompt: str) -> str:
        """Prepend memory context to a skill's base system prompt."""
        memory_block = self.memory.context_for_prompt()
        if memory_block:
            return memory_block + "\n\n---\n\n" + base_prompt
        return base_prompt

    def _chat_in_skill(
        self,
        skill_id: str,
        system_prompt: str,
        user_message: str,
        max_tokens: int = 512,
    ) -> dict:
        """Chat with Claude using a per-skill history. Returns {ok, text}."""
        if not self._client:
            # Caller decides which demo fallback to use; default safe message
            return {"ok": True, "text": DEMO_GAME_REPLY, "demo": True}

        full_system = self._build_system_prompt(system_prompt)
        history = self._histories.setdefault(skill_id, [])
        history.append({"role": "user", "content": user_message})

        try:
            response = self._client.messages.create(
                model=config.CHAT_MODEL,
                max_tokens=max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": full_system,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=history,
            )
        except anthropic.APIError as e:
            history.pop()
            return {"ok": False, "error": f"API error: {e}"}
        except Exception as e:
            history.pop()
            return {"ok": False, "error": f"Something went wrong: {e}"}

        text = next((b.text for b in response.content if b.type == "text"), "")
        history.append({"role": "assistant", "content": text})

        # Keep histories bounded so token usage doesn't grow unboundedly per session
        if len(history) > 40:
            del history[: len(history) - 30]

        # Track total messages for stats
        self.memory.increment_messages()

        return {"ok": True, "text": text}

    def reset_skill(self, skill_id: str) -> None:
        self._histories.pop(skill_id, None)

    def reset_chat(self) -> None:
        """Back-compat alias for the chat skill."""
        self.reset_skill("chat")

    # ---------- public skill methods ----------

    def chat(self, user_message: str) -> dict:
        if not self._client:
            return {"ok": True, "text": demo_mode.chat_reply(user_message), "demo": True}
        return self._chat_in_skill("chat", config.BUDDY_CHAT_SYSTEM, user_message, max_tokens=512)

    def twenty_questions(self, user_message: str) -> dict:
        return self._chat_in_skill(
            "twenty_questions",
            config.BUDDY_20Q_SYSTEM,
            user_message,
            max_tokens=300,
        )

    def story_time(self, user_message: str) -> dict:
        return self._chat_in_skill(
            "story_time",
            config.BUDDY_STORY_SYSTEM,
            user_message,
            max_tokens=400,
        )

    def curiosity(self, user_message: str) -> dict:
        return self._chat_in_skill(
            "curiosity",
            config.BUDDY_CURIOSITY_SYSTEM,
            user_message,
            max_tokens=500,
        )

    # ---------- robot ----------

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
