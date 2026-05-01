"""Python-side speech-to-text with press-to-start, press-to-stop control.

The browser's Web Speech API isn't enabled in WebView2 (Microsoft Edge's
embedded browser used by pywebview), so we record audio locally and
transcribe it server-side.

Engine: faster-whisper running locally (offline, very accurate, especially
for kid voices). First run lazily downloads the tiny.en model (~75 MB) to
~/.cache/huggingface. After that it's instant. Falls back to Google's free
endpoint if Whisper fails to load (e.g. C++ runtime missing).

Architecture: start_listening() spins up a background thread that records
mic frames into a buffer. stop_listening() signals the thread to stop,
joins it, then transcribes the buffered audio. Both calls return
immediately on the UI side — the transcription pass takes <1s on a
typical laptop CPU with the tiny.en model.
"""

from __future__ import annotations

import io
import threading
import wave
from typing import Optional

try:
    import speech_recognition as sr  # type: ignore
    SR_AVAILABLE = True
    SR_IMPORT_ERROR: Optional[str] = None
except Exception as e:
    SR_AVAILABLE = False
    SR_IMPORT_ERROR = str(e)

try:
    import pyaudio  # type: ignore
    PA_AVAILABLE = True
    PA_IMPORT_ERROR: Optional[str] = None
except Exception as e:
    PA_AVAILABLE = False
    PA_IMPORT_ERROR = str(e)

# Whisper is loaded lazily — first transcription pass triggers the model
# download. Keep _whisper_model global so it stays warm between calls.
_whisper_model = None
_whisper_load_error: Optional[str] = None

def _get_whisper_model():
    """Returns a faster-whisper model instance, or None if it fails to load.
    Loaded lazily because the import + model load takes a few seconds."""
    global _whisper_model, _whisper_load_error
    if _whisper_model is not None:
        return _whisper_model
    if _whisper_load_error is not None:
        return None  # already failed once, don't retry per-call
    try:
        from faster_whisper import WhisperModel  # type: ignore
        # tiny.en: 75 MB, very fast on CPU, plenty accurate for kid speech.
        # int8 quantization keeps it light on memory.
        _whisper_model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
        return _whisper_model
    except Exception as e:
        _whisper_load_error = str(e)
        print(f"[voice] Whisper unavailable, falling back to Google: {e}")
        return None


_SAMPLE_RATE = 16000
_CHUNK_SIZE = 1024
_FORMAT_PA = pyaudio.paInt16 if PA_AVAILABLE else None


class VoiceListener:
    def __init__(self) -> None:
        self._recognizer = sr.Recognizer() if SR_AVAILABLE else None
        if self._recognizer is not None:
            self._recognizer.energy_threshold = 300
            self._recognizer.dynamic_energy_threshold = True

        self._listening = False
        self._stop_event = threading.Event()
        self._frames: list[bytes] = []
        self._stream = None
        self._pa = None
        self._sample_width: Optional[int] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return SR_AVAILABLE and PA_AVAILABLE

    @property
    def is_listening(self) -> bool:
        return self._listening

    @property
    def import_error(self) -> Optional[str]:
        if not SR_AVAILABLE:
            return f"SpeechRecognition not available: {SR_IMPORT_ERROR}"
        if not PA_AVAILABLE:
            return f"PyAudio not available: {PA_IMPORT_ERROR}"
        return None

    def start_listening(self) -> dict:
        """Begin recording. Returns immediately so the UI can flip to the
        'listening' state without delay. The actual mic capture runs on a
        background thread until stop_listening() is called.
        """
        if not self.available:
            return {"ok": False, "error": self.import_error or "Voice unavailable"}

        with self._lock:
            if self._listening:
                return {"ok": True, "already": True}

            try:
                self._pa = pyaudio.PyAudio()
                self._sample_width = self._pa.get_sample_size(_FORMAT_PA)
                self._stream = self._pa.open(
                    format=_FORMAT_PA,
                    channels=1,
                    rate=_SAMPLE_RATE,
                    input=True,
                    frames_per_buffer=_CHUNK_SIZE,
                )
            except Exception as e:
                self._cleanup()
                return {"ok": False, "error": f"Mic problem: {e}"}

            self._frames = []
            self._stop_event.clear()
            self._listening = True
            self._thread = threading.Thread(target=self._record_loop, daemon=True)
            self._thread.start()
            return {"ok": True}

    def _record_loop(self) -> None:
        try:
            while not self._stop_event.is_set():
                try:
                    data = self._stream.read(_CHUNK_SIZE, exception_on_overflow=False)
                    self._frames.append(data)
                except Exception:
                    break
        finally:
            # No cleanup here — stop_listening() handles it under the lock.
            pass

    def stop_listening(self) -> dict:
        """Stop recording, transcribe, return text. Called when the kid
        presses the mic button a second time."""
        with self._lock:
            if not self._listening:
                return {"ok": False, "error": "Wasn't listening"}

            self._listening = False
            self._stop_event.set()
            thread = self._thread
            frames = list(self._frames)
            sample_width = self._sample_width

        if thread is not None:
            thread.join(timeout=2)

        # Cleanup audio resources before transcription so the mic is freed
        with self._lock:
            self._cleanup()

        if not frames:
            return {"ok": False, "error": "Biscuit didn't hear anything. Try again?"}

        # Build a WAV blob in memory
        wav_buffer = io.BytesIO()
        try:
            with wave.open(wav_buffer, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(sample_width or 2)
                wf.setframerate(_SAMPLE_RATE)
                wf.writeframes(b"".join(frames))
            wav_buffer.seek(0)
        except Exception as e:
            return {"ok": False, "error": f"Couldn't package audio: {e}"}

        # ----- Try Whisper first (offline, accurate) -----
        whisper = _get_whisper_model()
        if whisper is not None:
            try:
                # faster-whisper accepts BinaryIO directly
                segments, _info = whisper.transcribe(
                    wav_buffer,
                    beam_size=1,           # greedy decoding is fast and good for short utterances
                    language="en",
                    condition_on_previous_text=False,
                    no_speech_threshold=0.6,
                    vad_filter=True,       # skip leading/trailing silence
                )
                text = " ".join(s.text for s in segments).strip()
                if text:
                    return {"ok": True, "text": text, "engine": "whisper"}
                # Empty transcription — try Google as fallback
                wav_buffer.seek(0)
            except Exception as e:
                print(f"[voice] Whisper transcription error, falling back: {e}")
                wav_buffer.seek(0)

        # ----- Fallback: Google free endpoint -----
        try:
            with sr.AudioFile(wav_buffer) as source:
                audio = self._recognizer.record(source)
        except Exception as e:
            return {"ok": False, "error": f"Audio read error: {e}"}

        try:
            text = self._recognizer.recognize_google(audio)
            text = (text or "").strip()
            if not text:
                return {"ok": False, "error": "Couldn't understand. Try again?"}
            return {"ok": True, "text": text, "engine": "google"}
        except sr.UnknownValueError:
            return {"ok": False, "error": "Couldn't understand. Try again?"}
        except sr.RequestError as e:
            return {"ok": False, "error": f"Voice service offline: {e}"}
        except Exception as e:
            return {"ok": False, "error": f"Recognition error: {e}"}

    def _cleanup(self) -> None:
        try:
            if self._stream:
                self._stream.stop_stream()
                self._stream.close()
        except Exception:
            pass
        try:
            if self._pa:
                self._pa.terminate()
        except Exception:
            pass
        self._stream = None
        self._pa = None
        self._sample_width = None
        self._thread = None
        self._frames = []
