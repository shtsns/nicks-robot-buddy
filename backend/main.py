"""Entry point for Nick's Robot Buddy.

Opens a pywebview window pointing at frontend/index.html and exposes a small
Python API to the JS via window.pywebview.api.*.
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path
from typing import Optional

import webview

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_INDEX = PROJECT_ROOT / "frontend" / "index.html"

# Make `from backend...` imports work whether we run as a module or a script.
sys.path.insert(0, str(PROJECT_ROOT))

from backend import config  # noqa: E402
from backend.buddy_brain import BuddyBrain  # noqa: E402
from backend.robot_serial import RobotAction, RobotConnection, list_serial_ports  # noqa: E402
from backend.voice import VoiceListener  # noqa: E402


class API:
    def __init__(self):
        self._window: Optional[webview.Window] = None
        self._brain = BuddyBrain()
        self._robot = RobotConnection(log_callback=self._on_robot_log)
        self._robot_thread: Optional[threading.Thread] = None
        self._voice = VoiceListener()

    def _attach_window(self, window: webview.Window) -> None:
        self._window = window

    def _on_robot_log(self, message: str) -> None:
        if self._window is not None:
            try:
                safe = message.replace("\\", "\\\\").replace("'", "\\'")
                self._window.evaluate_js(f"window.onRobotLog && window.onRobotLog('{safe}')")
            except Exception:
                pass

    def get_status(self) -> dict:
        return {
            "ai_ready": self._brain.ready,
            "demo_mode": self._brain.demo_mode,
            "ai_error": self._brain.init_error,
            "robot_connected": self._robot.is_connected,
            "robot_port": self._robot.port_name,
            "max_total_seconds": config.MAX_TOTAL_SECONDS,
            "voice_available": self._voice.available,
            "voice_error": self._voice.import_error,
        }

    def start_listening(self) -> dict:
        """Begin recording from the mic. Returns immediately so the UI flips
        to the 'listening' state without delay."""
        return self._voice.start_listening()

    def stop_listening(self) -> dict:
        """Stop recording, transcribe, return text. Called on the second
        mic-button press."""
        return self._voice.stop_listening()

    def list_ports(self) -> list[dict]:
        return list_serial_ports()

    def connect_robot(self, port: str) -> dict:
        return self._robot.connect(port)

    def disconnect_robot(self) -> dict:
        self._robot.disconnect()
        return {"ok": True}

    def chat(self, message: str) -> dict:
        return self._brain.chat(message)

    def twenty_questions(self, message: str) -> dict:
        return self._brain.twenty_questions(message)

    def story_time(self, message: str) -> dict:
        return self._brain.story_time(message)

    def curiosity(self, message: str) -> dict:
        return self._brain.curiosity(message)

    def reset_chat(self) -> dict:
        self._brain.reset_chat()
        return {"ok": True}

    def reset_skill(self, skill_id: str) -> dict:
        self._brain.reset_skill(skill_id)
        return {"ok": True}

    def get_memory(self) -> dict:
        """Returns everything Buddy remembers about Nick."""
        return self._brain.memory.get_all()

    def update_memory(self, kid_data: dict) -> dict:
        """Update what Buddy knows about Nick (name, age, birthday, favorites)."""
        if not isinstance(kid_data, dict):
            return {"ok": False, "error": "expected an object"}
        self._brain.memory.update_kid(kid_data)
        return {"ok": True, "memory": self._brain.memory.get_all()}

    def update_preferences(self, prefs: dict) -> dict:
        """Persist UI preferences (e.g. voice name) to the memory file so
        they survive even if WebView local storage gets cleared."""
        if not isinstance(prefs, dict):
            return {"ok": False, "error": "expected an object"}
        self._brain.memory.update_preferences(prefs)
        return {"ok": True}

    # ---------- Photo Booth ----------

    def save_photo(self, data_url: str) -> dict:
        """Save a captured photo (data: URL with base64 PNG/JPEG) to disk."""
        from base64 import b64decode
        from datetime import datetime as _dt
        from backend.memory import photos_dir

        if not isinstance(data_url, str) or "," not in data_url:
            return {"ok": False, "error": "Invalid photo data"}
        try:
            header, b64 = data_url.split(",", 1)
            ext = "jpg" if ("image/jpeg" in header or "image/jpg" in header) else "png"
            img_bytes = b64decode(b64)
        except Exception as e:
            return {"ok": False, "error": f"Decode error: {e}"}
        if len(img_bytes) > 8 * 1024 * 1024:
            return {"ok": False, "error": "Photo too big"}

        target_dir = photos_dir()
        target_dir.mkdir(parents=True, exist_ok=True)
        ts = _dt.now().strftime("%Y%m%d-%H%M%S")
        filename = f"biscuit-{ts}.{ext}"
        path = target_dir / filename
        try:
            with open(path, "wb") as f:
                f.write(img_bytes)
        except Exception as e:
            return {"ok": False, "error": f"Save failed: {e}"}

        self._brain.memory.increment_photos()
        return {"ok": True, "path": str(path), "filename": filename, "data_url": data_url}

    def list_photos(self, limit: int = 12) -> dict:
        """Recent photos for the gallery, returned as data URLs."""
        from base64 import b64encode
        from backend.memory import photos_dir

        try:
            files = sorted(
                [p for p in photos_dir().glob("biscuit-*.*") if p.is_file()],
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )[:limit]
        except Exception:
            files = []

        items = []
        for p in files:
            try:
                with open(p, "rb") as f:
                    img = f.read()
                mime = "image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                items.append({
                    "filename": p.name,
                    "path": str(p),
                    "data_url": f"data:{mime};base64,{b64encode(img).decode('ascii')}",
                })
            except Exception:
                continue
        return {"ok": True, "photos": items}

    def open_photos_folder(self) -> dict:
        """Open the photos folder in Windows Explorer."""
        import subprocess
        from backend.memory import photos_dir

        target = photos_dir()
        target.mkdir(parents=True, exist_ok=True)
        try:
            subprocess.Popen(["explorer", str(target)])
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def robot_command(self, message: str) -> dict:
        plan_result = self._brain.plan_robot(message)
        if not plan_result.get("ok"):
            return plan_result

        plan = plan_result["plan"]
        actions = [RobotAction(action=a["action"], seconds=a.get("seconds", 0)) for a in plan["actions"]]

        if actions:
            self._run_actions_in_background(actions)
            self._brain.memory.increment_robot_drives()

        return {"ok": True, "plan": plan}

    def _run_actions_in_background(self, actions: list[RobotAction]) -> None:
        if self._robot_thread and self._robot_thread.is_alive():
            self._robot.stop()
            self._robot_thread.join(timeout=1.0)

        def runner():
            self._robot.run_actions(actions, speed=config.DEFAULT_MOTOR_SPEED)
            if self._window is not None:
                try:
                    self._window.evaluate_js("window.onRobotDone && window.onRobotDone()")
                except Exception:
                    pass

        self._robot_thread = threading.Thread(target=runner, daemon=True)
        self._robot_thread.start()

    def emergency_stop(self) -> dict:
        self._robot.stop()
        return {"ok": True}

    def robot_dance(self) -> dict:
        """Picks a random predefined dance sequence and runs it."""
        import random
        dance = random.choice(config.ROBOT_DANCES)
        actions = [
            RobotAction(action=a["action"], seconds=a.get("seconds", 0))
            for a in dance["actions"]
        ]
        self._run_actions_in_background(actions)
        self._brain.memory.increment_robot_drives()
        return {
            "ok": True,
            "name": dance["name"],
            "narration": dance["narration"],
        }


def main() -> None:
    if not FRONTEND_INDEX.exists():
        print(f"Could not find frontend at {FRONTEND_INDEX}")
        sys.exit(1)

    api = API()
    window = webview.create_window(
        title="Nick & Biscuit",
        url=str(FRONTEND_INDEX),
        js_api=api,
        width=1100,
        height=780,
        min_size=(900, 650),
        background_color="#FFF8E7",
    )
    api._attach_window(window)
    # private_mode=False so localStorage (e.g. voice picker choice) survives
    # restarts. Also passes a stable storage_path so WebView2 keeps its
    # state in the user's Documents folder alongside the rest of our data.
    from backend.memory import app_data_root
    storage_path = str((app_data_root() / "webview").resolve())
    os.makedirs(storage_path, exist_ok=True)
    webview.start(
        debug=os.environ.get("BUDDY_DEBUG") == "1",
        private_mode=False,
        storage_path=storage_path,
    )


if __name__ == "__main__":
    main()
