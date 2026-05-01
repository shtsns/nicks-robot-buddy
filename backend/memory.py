"""Persistent memory for Biscuit.

Stores what Biscuit "remembers" about Nick across sessions, plus play stats
and user preferences. Lives in the user's Documents folder so it survives
app updates, reinstalls, and OneDrive sync.

  Path: ~/Documents/NicksRobotBuddy/memory.json
  Photos: ~/Documents/NicksRobotBuddy/photos/

If a memory.json exists at the old %LOCALAPPDATA% path from earlier
versions, it gets migrated forward automatically on first run.

The memory data is injected into every skill's system prompt so Biscuit
addresses Nick by name, references his favorites, knows his birthday,
and feels continuous across all skills.
"""

from __future__ import annotations

import copy
import json
import os
import re
import shutil
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional


DEFAULT_DATA: dict = {
    "kid": {
        "name": "",
        "age": 8,
        "birthday": "",  # MM/DD format, e.g. "5/2"
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
        "photos_taken": 0,
    },
    "preferences": {
        "voice_name": "",
    },
    "highlights": [],
}


def app_data_root() -> Path:
    """Resolve the per-user data folder under Documents.

    On Windows uses Documents. Falls back to a hidden folder in $HOME on
    other platforms (the app is Windows-targeted but be safe).
    """
    home = Path.home()
    docs = home / "Documents"
    if docs.exists():
        return docs / "NicksRobotBuddy"
    # Some Windows configs redirect Documents into OneDrive
    onedrive_docs = home / "OneDrive" / "Documents"
    if onedrive_docs.exists():
        return onedrive_docs / "NicksRobotBuddy"
    return home / ".nicks-robot-buddy"


def memory_path() -> Path:
    return app_data_root() / "memory.json"


def photos_dir() -> Path:
    return app_data_root() / "photos"


def _legacy_memory_path() -> Optional[Path]:
    """Path used by earlier versions (%LOCALAPPDATA%\\NicksRobotBuddy)."""
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        return None
    return Path(base) / "NicksRobotBuddy" / "memory.json"


# ---- US holidays for countdown context ----

def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Nth occurrence of a weekday in a month. weekday: Mon=0 ... Sun=6.
    n=1 means first, n=-1 means last."""
    if n > 0:
        d = date(year, month, 1)
        while d.weekday() != weekday:
            d = d.replace(day=d.day + 1)
        return d.replace(day=d.day + 7 * (n - 1))
    # Last
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    last = next_month - _ONE_DAY
    while last.weekday() != weekday:
        last = last - _ONE_DAY
    return last


from datetime import timedelta as _TD
_ONE_DAY = _TD(days=1)


def _holidays_for_year(year: int) -> list[tuple[date, str]]:
    out = [
        (date(year, 1, 1), "New Year's Day"),
        (date(year, 2, 14), "Valentine's Day"),
        (date(year, 3, 17), "St. Patrick's Day"),
        (date(year, 7, 4), "the Fourth of July"),
        (date(year, 10, 31), "Halloween"),
        (date(year, 12, 25), "Christmas"),
    ]
    # Mother's Day = 2nd Sunday of May
    out.append((_nth_weekday(year, 5, 6, 2), "Mother's Day"))
    # Father's Day = 3rd Sunday of June
    out.append((_nth_weekday(year, 6, 6, 3), "Father's Day"))
    # Thanksgiving = 4th Thursday of November
    out.append((_nth_weekday(year, 11, 3, 4), "Thanksgiving"))
    return out


def _parse_birthday_mmdd(s: str) -> Optional[tuple[int, int]]:
    if not s:
        return None
    m = re.match(r"^\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*$", s.strip())
    if not m:
        return None
    month, day = int(m.group(1)), int(m.group(2))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return (month, day)


def _days_until(target: date, today: date) -> int:
    return (target - today).days


def _next_occurrence(month: int, day: int, today: date) -> date:
    try:
        candidate = date(today.year, month, day)
    except ValueError:
        # e.g. Feb 29 in a non-leap year — bump to Feb 28
        candidate = date(today.year, month, 28)
    if candidate < today:
        try:
            candidate = date(today.year + 1, month, day)
        except ValueError:
            candidate = date(today.year + 1, month, 28)
    return candidate


def upcoming_events_block(birthday_mmdd: str, today: Optional[date] = None) -> str:
    """Build the 'today is X / countdown to Y' block for system prompt injection.

    Returns the closest upcoming events within ~45 days. Empty string if
    nothing relevant is on the horizon.
    """
    today = today or date.today()
    events: list[tuple[int, str]] = []

    # Birthday first if known
    bday = _parse_birthday_mmdd(birthday_mmdd or "")
    if bday:
        target = _next_occurrence(bday[0], bday[1], today)
        days = _days_until(target, today)
        events.append((days, "your birthday"))

    # Holidays for this year and next year (in case Jan 1 is around the corner)
    for year in (today.year, today.year + 1):
        for d, name in _holidays_for_year(year):
            days = _days_until(d, today)
            if days >= 0:
                events.append((days, name))

    # Sort by days remaining; show only those within 45 days, max 3
    events.sort(key=lambda e: e[0])
    upcoming = [e for e in events if e[0] <= 45][:3]
    if not upcoming:
        return ""

    lines = [f"Today is {today.strftime('%A, %B %d, %Y')}."]
    closest_days = upcoming[0][0]

    for days, name in upcoming:
        if days == 0:
            lines.append(f"🎉 TODAY IS {name.upper()}! Mention this proudly!")
        elif days == 1:
            lines.append(f"⭐ TOMORROW IS {name}! Big deal — bring it up.")
        elif days <= 7:
            lines.append(f"⭐ {name} is only {days} days away — definitely a hype-worthy event.")
        else:
            lines.append(f"{name} is {days} days away.")

    if closest_days <= 7:
        lines.append(
            "There's an exciting event within the week — mention it ENERGETICALLY in your "
            "first reply or two of this conversation, then naturally reference it as you "
            "talk. Build excitement! Use phrases like 'only X more days!' or 'can you "
            "believe [event] is so close?!'"
        )
    else:
        lines.append(
            "Naturally reference an upcoming event SOMETIMES (not every reply — once "
            "every few conversations) to build excitement. Don't force it."
        )
    return "\n".join(lines)


class Memory:
    def __init__(self) -> None:
        self.path = memory_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        photos_dir().mkdir(parents=True, exist_ok=True)
        self._migrate_from_legacy()
        self.data = self._load()
        self._record_session_start()

    def _migrate_from_legacy(self) -> None:
        """Copy old %LOCALAPPDATA% memory.json to the new Documents path on
        first run. Idempotent — only runs if new file doesn't exist yet."""
        if self.path.exists():
            return
        legacy = _legacy_memory_path()
        if legacy and legacy.exists():
            try:
                shutil.copy2(legacy, self.path)
                print(f"[memory] migrated legacy memory from {legacy} to {self.path}")
            except Exception as e:
                print(f"[memory] legacy migration failed: {e}")

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

    def get_preferences(self) -> dict:
        return copy.deepcopy(self.data.get("preferences", {}))

    def update_kid(self, updates: dict) -> None:
        for k, v in updates.items():
            if k in self.data["kid"]:
                self.data["kid"][k] = v
        self.save()

    def update_preferences(self, updates: dict) -> None:
        prefs = self.data.setdefault("preferences", {})
        for k, v in updates.items():
            prefs[k] = v
        self.save()

    def increment_messages(self) -> None:
        self.data["stats"]["total_messages"] += 1
        self.save()

    def increment_robot_drives(self) -> None:
        self.data["stats"]["robot_drives"] += 1
        self.save()

    def increment_photos(self) -> None:
        self.data["stats"]["photos_taken"] = self.data["stats"].get("photos_taken", 0) + 1
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
        """Build a 'What Biscuit knows about Nick' block for system prompt injection.

        Returns empty string if no name is set yet — Biscuit plays neutral.
        """
        kid = self.data["kid"]
        stats = self.data["stats"]

        # Even with no name, we still surface the date + holidays block so
        # Biscuit can mention "Halloween is in 8 days" type stuff.
        sections = []

        if kid.get("name"):
            lines = [
                "WHAT YOU KNOW ABOUT YOUR FRIEND (use this NATURALLY, don't dump it):",
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
                "Use his name sometimes. Reference his favorites when relevant. "
                "Don't reveal everything in one message — be natural."
            )
            sections.append("\n".join(lines))

        # Date / countdowns block
        events = upcoming_events_block(kid.get("birthday", ""))
        if events:
            sections.append(events)

        return "\n\n---\n\n".join(sections)


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
