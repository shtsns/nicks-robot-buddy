"""Persistent memory for Buddy.

Stores what Buddy "remembers" about Nick across sessions, plus play stats.
Lives at %LOCALAPPDATA%\\NicksRobotBuddy\\memory.json — outside OneDrive
sync paths, per-user, survives app reinstalls.

The memory data is injected into every skill's system prompt so Buddy
addresses Nick by name, references his favorites, and feels continuous
across the chat / 20 Questions / Story Time / Curiosity / Robot views.
"""

from __future__ import annotations

import copy
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


DEFAULT_DATA: dict = {
    "kid": {
        "name": "",
        "age": 8,
        "favorite_color": "",
        "favorite_animal": "",
        "favorite_food": "",
        "loves": "",
    },
    "stats": {
        "first_session": "",
        "last_session": "",
        "total_sessions": 0,
        "total_messages": 0,
        "robot_drives": 0,
    },
    "highlights": [],
}


def memory_path() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "NicksRobotBuddy" / "memory.json"
    # Fallback for non-Windows / odd environments
    return Path.home() / ".nicks-robot-buddy" / "memory.json"


class Memory:
    def __init__(self) -> None:
        self.path = memory_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.data = self._load()
        self._record_session_start()

    def _load(self) -> dict:
        if self.path.exists():
            try:
                with open(self.path, encoding="utf-8") as f:
                    data = json.load(f)
                return self._merge_defaults(data)
            except Exception:
                pass
        return copy.deepcopy(DEFAULT_DATA)

    def _merge_defaults(self, data: dict) -> dict:
        merged = copy.deepcopy(DEFAULT_DATA)
        for top_key, top_val in data.items():
            if top_key in merged and isinstance(top_val, dict) and isinstance(merged[top_key], dict):
                merged[top_key].update(top_val)
            else:
                merged[top_key] = top_val
        return merged

    def save(self) -> None:
        try:
            tmp = self.path.with_suffix(".json.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            tmp.replace(self.path)
        except Exception as e:
            # Don't crash the app over memory save failures; log and move on
            print(f"[memory] save failed: {e}")

    def _record_session_start(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if not self.data["stats"]["first_session"]:
            self.data["stats"]["first_session"] = now
        self.data["stats"]["last_session"] = now
        self.data["stats"]["total_sessions"] += 1
        self.save()

    # ----- public API -----

    def get_all(self) -> dict:
        return copy.deepcopy(self.data)

    def get_kid(self) -> dict:
        return copy.deepcopy(self.data["kid"])

    def update_kid(self, updates: dict) -> None:
        for k, v in updates.items():
            if k in self.data["kid"]:
                self.data["kid"][k] = v
        self.save()

    def increment_messages(self) -> None:
        self.data["stats"]["total_messages"] += 1
        self.save()

    def increment_robot_drives(self) -> None:
        self.data["stats"]["robot_drives"] += 1
        self.save()

    def add_highlight(self, text: str) -> None:
        self.data["highlights"].append({
            "when": datetime.now(timezone.utc).isoformat(),
            "text": text,
        })
        # Keep the last 20 highlights so memory doesn't grow unbounded
        self.data["highlights"] = self.data["highlights"][-20:]
        self.save()

    def context_for_prompt(self) -> str:
        """Build a 'What Buddy knows about Nick' block for system prompt injection.

        Returns empty string if no name is set yet — Buddy plays neutral.
        """
        kid = self.data["kid"]
        stats = self.data["stats"]

        if not kid.get("name"):
            return ""

        lines = [
            "WHAT YOU KNOW ABOUT YOUR FRIEND (use this NATURALLY across the conversation, "
            "don't list it all at once — sprinkle it in like an actual friend would):",
            f"- Name: {kid['name']}",
        ]
        if kid.get("age"):
            lines.append(f"- Age: {kid['age']}")
        if kid.get("favorite_color"):
            lines.append(f"- Favorite color: {kid['favorite_color']}")
        if kid.get("favorite_animal"):
            lines.append(f"- Favorite animal: {kid['favorite_animal']}")
        if kid.get("favorite_food"):
            lines.append(f"- Favorite food: {kid['favorite_food']}")
        if kid.get("loves"):
            lines.append(f"- Things he loves: {kid['loves']}")

        sessions = stats.get("total_sessions", 0)
        if sessions > 1:
            lines.append(f"- This is your {_ordinal(sessions)} time playing together!")

        highlights = self.data.get("highlights", [])
        if highlights:
            lines.append("- Recent things you remember:")
            for h in highlights[-3:]:
                lines.append(f"  • {h.get('text', '')}")

        lines.append(
            "Use his name sometimes when you talk. Reference his favorites when relevant "
            "(if he asks for a story, his favorite animal might show up). Don't reveal "
            "everything you know in one message — that's creepy. Be natural."
        )
        return "\n".join(lines)


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
