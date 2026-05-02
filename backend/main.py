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
from backend.eleven import ElevenLabs, DEFAULT_VOICE_ID  # noqa: E402


class API:
    def __init__(self):
        self._window: Optional[webview.Window] = None
        self._brain = BuddyBrain()
        self._robot = RobotConnection(log_callback=self._on_robot_log)
        self._robot_thread: Optional[threading.Thread] = None
        self._voice = VoiceListener()
        self._eleven = ElevenLabs()

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
            "eleven_ready": self._eleven.ready,
            "eleven_error": self._eleven.init_error,
        }

    # ---------- Premium TTS via ElevenLabs ----------

    def synthesize_speech(self, text: str, voice_id: str = "", with_timestamps: bool = True) -> dict:
        """Synthesize TTS audio via ElevenLabs. Returns either:
          - {fallback: True, reason: ...} if the key isn't set / API fails
          - {data_url, alignment} for ElevenLabs success (with character-level
            alignment driving real lip sync on the frontend)

        with_timestamps=True uses the /with-timestamps endpoint so the
        frontend can drive mouth animation from real character timing.
        """
        if not self._eleven.ready:
            return {"ok": True, "fallback": True, "reason": "no_key"}
        try:
            chosen_voice = (
                voice_id
                or self._brain.memory.get_preferences().get("eleven_voice_id")
                or None
            )
            if with_timestamps:
                result = self._eleven.synthesize_with_timestamps(text, chosen_voice)
                return {
                    "ok": True,
                    "fallback": False,
                    "data_url": f"data:audio/mpeg;base64,{result['audio_b64']}",
                    "alignment": result["alignment"],
                }
            audio_bytes = self._eleven.synthesize(text, chosen_voice)
            from base64 import b64encode
            return {
                "ok": True,
                "fallback": False,
                "data_url": f"data:audio/mpeg;base64,{b64encode(audio_bytes).decode('ascii')}",
            }
        except Exception as e:
            return {"ok": True, "fallback": True, "reason": str(e)}

    def list_eleven_voices(self) -> dict:
        return {"ok": True, "voices": self._eleven.list_voices()}

    def list_bark_sounds(self) -> dict:
        """Return base64-encoded bundled bark MP3s if they exist. Frontend
        prefers these over Web Audio synthesis."""
        from base64 import b64encode
        sounds_dir = PROJECT_ROOT / "assets" / "sounds"
        items = []
        if sounds_dir.exists():
            for p in sorted(sounds_dir.glob("bark_*.mp3")):
                try:
                    items.append({
                        "name": p.stem,
                        "data_url": f"data:audio/mpeg;base64,{b64encode(p.read_bytes()).decode('ascii')}",
                    })
                except Exception:
                    continue
        return {"ok": True, "sounds": items}

    def eleven_usage(self) -> dict:
        u = self._eleven.usage()
        if u is None:
            return {"ok": False}
        return {"ok": True, **u}

    # ---------- API key management (paste-once UI) ----------

    def get_api_keys_status(self) -> dict:
        """Returns which API keys are currently set and where they came from."""
        from backend.secrets import get_secrets
        import os
        secrets = get_secrets()
        return {
            "ok": True,
            "anthropic": {
                "set": bool(self._brain.ready),
                "from_env": bool(os.environ.get("ANTHROPIC_API_KEY")),
                "from_file": bool(secrets.get("anthropic_api_key")),
            },
            "elevenlabs": {
                "set": bool(self._eleven.ready),
                "from_env": bool(os.environ.get("ELEVENLABS_API_KEY")),
                "from_file": bool(secrets.get("elevenlabs_api_key")),
            },
        }

    def set_api_key(self, name: str, value: str) -> dict:
        """Save an API key to Documents/NicksRobotBuddy/secrets.json.
        Takes effect immediately — both ElevenLabs and Anthropic clients
        re-resolve the key on every call, so no restart is needed."""
        from backend.secrets import get_secrets, KEY_REGISTRY
        valid_names = set(KEY_REGISTRY.values())
        if name not in valid_names:
            return {"ok": False, "error": f"unknown key '{name}'"}
        get_secrets().set(name, (value or "").strip())
        return {"ok": True}

    def get_version_info(self) -> dict:
        """Diagnostic snapshot: what version + deps are actually loaded.

        Use this to verify an UPDATE.bat actually took effect. The 'commit'
        field is the git short hash currently checked out — it should match
        the latest commit on the GitHub repo's main branch.
        """
        import platform, sys
        info = {
            "commit": GIT_INFO.get("short", "unknown"),
            "branch": GIT_INFO.get("branch", ""),
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "anthropic_ready": self._brain.ready,
            "anthropic_demo": self._brain.demo_mode,
            "eleven_ready": self._eleven.ready,
            "voice_pyaudio": self._voice.available,
        }
        # Whisper status — call private fn to avoid loading the model just for the check
        try:
            from backend.voice import _whisper_model, _whisper_load_error
            info["whisper_loaded"] = _whisper_model is not None
            info["whisper_error"] = _whisper_load_error or ""
            try:
                import faster_whisper  # type: ignore
                info["whisper_installed"] = True
            except Exception:
                info["whisper_installed"] = False
        except Exception:
            info["whisper_loaded"] = False
            info["whisper_installed"] = False

        # Bundled barks
        try:
            sounds = list((PROJECT_ROOT / "assets" / "sounds").glob("bark_*.mp3"))
            info["bundled_barks"] = len(sounds)
        except Exception:
            info["bundled_barks"] = 0

        # Anthropic + Eleven SDK versions
        try:
            import anthropic as _a
            info["anthropic_version"] = getattr(_a, "__version__", "?")
        except Exception:
            info["anthropic_version"] = "?"
        try:
            import httpx as _h
            info["httpx_version"] = getattr(_h, "__version__", "?")
        except Exception:
            info["httpx_version"] = "?"

        return info

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


def _read_git_commit() -> dict:
    """Read the current git commit hash from .git/HEAD without invoking git.
    Returns {short, full, branch} or {short: 'unknown', ...} on failure."""
    try:
        head_path = PROJECT_ROOT / ".git" / "HEAD"
        head = head_path.read_text(encoding="utf-8").strip()
        if head.startswith("ref: "):
            ref = head[5:]
            branch = ref.split("/")[-1]
            ref_path = PROJECT_ROOT / ".git" / ref
            if ref_path.exists():
                full = ref_path.read_text(encoding="utf-8").strip()
                return {"short": full[:8], "full": full, "branch": branch}
            # packed-refs fallback
            packed = PROJECT_ROOT / ".git" / "packed-refs"
            if packed.exists():
                for line in packed.read_text(encoding="utf-8").splitlines():
                    if line.endswith(" " + ref):
                        full = line.split(" ")[0]
                        return {"short": full[:8], "full": full, "branch": branch}
            return {"short": "no-ref", "full": "", "branch": branch}
        # detached HEAD: head is the commit hash directly
        return {"short": head[:8], "full": head, "branch": "(detached)"}
    except Exception as e:
        return {"short": "unknown", "full": "", "branch": "", "error": str(e)}


GIT_INFO = _read_git_commit()


def _prepare_runtime_html(commit: str) -> Path:
    """Read frontend/index.html, append cache-busting query strings to JS/CSS
    references, ensure no-cache meta tags, and write a runtime copy that
    pywebview loads. Avoids stale WebView2 cached JS/CSS after git pulls."""
    src = FRONTEND_INDEX.read_text(encoding="utf-8")
    cb = commit or "dev"
    src = src.replace('href="style.css"', f'href="style.css?v={cb}"')
    src = src.replace('src="app.js"', f'src="app.js?v={cb}"')
    if "Cache-Control" not in src:
        src = src.replace(
            "<head>",
            '<head>\n  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">\n  <meta http-equiv="Pragma" content="no-cache">',
            1,
        )
    # Inject a global window.BUDDY_VERSION for diagnostic visibility
    src = src.replace(
        "<script src=\"app.js?v=",
        f'<script>window.BUDDY_VERSION = "{cb}";</script>\n  <script src="app.js?v=',
    )
    runtime = FRONTEND_INDEX.parent / ".runtime_index.html"
    runtime.write_text(src, encoding="utf-8")
    return runtime


def main() -> None:
    if not FRONTEND_INDEX.exists():
        print(f"Could not find frontend at {FRONTEND_INDEX}")
        sys.exit(1)

    runtime_html = _prepare_runtime_html(GIT_INFO.get("short", ""))
    print(f"[buddy] starting build {GIT_INFO.get('short', '?')} on branch {GIT_INFO.get('branch', '?')}")

    # Warm Whisper in the background so it's loaded by the time Nick uses
    # the mic. Doesn't block startup. First-time download (~75MB) happens
    # silently. Once warm, transcription is instant.
    def _warm_whisper():
        try:
            from backend.voice import _get_whisper_model
            print("[buddy] warming Whisper model in background...")
            _get_whisper_model()
            print("[buddy] Whisper warm and ready")
        except Exception as e:
            print(f"[buddy] Whisper warm failed: {e}")
    threading.Thread(target=_warm_whisper, daemon=True).start()

    api = API()
    window = webview.create_window(
        title=f"Nick & Biscuit  ({GIT_INFO.get('short', 'dev')})",
        url=str(runtime_html),
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
