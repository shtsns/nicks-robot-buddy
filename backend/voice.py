"""Python-side speech-to-text.

The browser's Web Speech API isn't enabled in WebView2 (Microsoft Edge's
embedded browser used by pywebview), so we record audio with the local
microphone and transcribe it with Google's free recognition endpoint via
the SpeechRecognition library.

One blocking listen per call — kid taps mic, speaks, silence triggers
auto-stop, transcription returns. No press-and-hold, no keep-alive.
"""

from __future__ import annotations

from typing import Optional

try:
    import speech_recognition as sr  # type: ignore
    SR_AVAILABLE = True
    SR_IMPORT_ERROR: Optional[str] = None
except Exception as e:  # ImportError, OSError if PyAudio missing, etc.
    SR_AVAILABLE = False
    SR_IMPORT_ERROR = str(e)


class VoiceListener:
    def __init__(self) -> None:
        self._recognizer = sr.Recognizer() if SR_AVAILABLE else None
        if self._recognizer is not None:
            # Tuned for a kid in a typical home: don't auto-trip on quiet
            # background noise, but stop quickly when they pause.
            self._recognizer.energy_threshold = 300
            self._recognizer.dynamic_energy_threshold = True
            self._recognizer.pause_threshold = 0.7

    @property
    def available(self) -> bool:
        return SR_AVAILABLE

    @property
    def import_error(self) -> Optional[str]:
        return SR_IMPORT_ERROR

    def listen_once(self, phrase_time_limit: int = 12, timeout: int = 5) -> dict:
        """Record one phrase and transcribe. Auto-stops on silence.

        Returns:
            {"ok": True, "text": "..."} on success
            {"ok": False, "error": "..."} otherwise
        """
        if not self._recognizer:
            return {
                "ok": False,
                "error": SR_IMPORT_ERROR or "Speech recognition not available",
            }

        try:
            with sr.Microphone() as source:
                # Quick ambient noise calibration so the kid's room baseline
                # doesn't trip the recognizer.
                self._recognizer.adjust_for_ambient_noise(source, duration=0.3)
                audio = self._recognizer.listen(
                    source, timeout=timeout, phrase_time_limit=phrase_time_limit
                )
        except sr.WaitTimeoutError:
            return {"ok": False, "error": "Buddy didn't hear anything. Try again?"}
        except OSError as e:
            return {"ok": False, "error": f"Microphone problem: {e}"}
        except Exception as e:
            return {"ok": False, "error": f"Recording problem: {e}"}

        try:
            text = self._recognizer.recognize_google(audio)
            return {"ok": True, "text": text}
        except sr.UnknownValueError:
            return {"ok": False, "error": "Couldn't understand. Try again?"}
        except sr.RequestError as e:
            return {"ok": False, "error": f"Voice service offline: {e}"}
        except Exception as e:
            return {"ok": False, "error": f"Recognition error: {e}"}
