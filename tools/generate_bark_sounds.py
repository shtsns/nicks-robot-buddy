"""Generate Biscuit's bark library using the ElevenLabs Sound Effects API.

Run once after setting ELEVENLABS_API_KEY:

    .venv\\Scripts\\python.exe tools\\generate_bark_sounds.py

Output: assets/sounds/bark_*.mp3 (committed to the repo so the kid never
waits on this; just re-run if you want to regenerate variations).

The frontend prefers these bundled samples and falls back to the Web Audio
synthesis if any are missing.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx


PROMPTS = [
    ("bark_01_classic.mp3", "A friendly small dog single bark, short and clear"),
    ("bark_02_excited.mp3", "An excited puppy yip-bark, high pitched and energetic"),
    ("bark_03_low.mp3",     "A low gentle woof from a medium dog, single bark"),
    ("bark_04_yip.mp3",     "A small puppy yip, very short and high"),
    ("bark_05_double.mp3",  "Two quick happy small dog barks, woof woof"),
    ("bark_06_huff.mp3",    "A short happy snort or huff from a small dog"),
]

DURATION_SECONDS = 1.0  # ElevenLabs SFX API expects float seconds


def main() -> int:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        print("ELEVENLABS_API_KEY not set. Set it first:")
        print('    setx ELEVENLABS_API_KEY "sk_..."')
        return 1

    out = Path(__file__).resolve().parent.parent / "assets" / "sounds"
    out.mkdir(parents=True, exist_ok=True)

    client = httpx.Client(timeout=120.0)
    for filename, prompt in PROMPTS:
        target = out / filename
        if target.exists() and target.stat().st_size > 1024:
            print(f"[skip] {filename} (already present)")
            continue
        print(f"[gen]  {filename} ... ", end="", flush=True)
        try:
            resp = client.post(
                "https://api.elevenlabs.io/v1/sound-generation",
                headers={
                    "xi-api-key": key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                json={
                    "text": prompt,
                    "duration_seconds": DURATION_SECONDS,
                    "prompt_influence": 0.5,
                },
            )
            if resp.status_code != 200:
                print(f"FAIL ({resp.status_code}): {resp.text[:120]}")
                continue
            target.write_bytes(resp.content)
            print(f"OK ({len(resp.content)//1024} KB)")
        except Exception as e:
            print(f"ERROR: {e}")
            continue

    print()
    print(f"Done. Bundled barks saved to {out}")
    print("Commit and push assets/sounds/*.mp3 so they ship with the app.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
