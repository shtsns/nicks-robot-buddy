# Nick's Robot Buddy

A small AI app for an 8-year-old. Nick types or speaks; Buddy the puppy talks back, tells jokes, and drives a Makeblock mBot.

## What's inside

- **Talk to Buddy** — voice or text chat with a kid-safe puppy persona, powered by Claude.
- **Drive the Robot** — say things like *"go forward 3 seconds and turn right"* and Buddy translates into mBot motor commands over Bluetooth.
- **STOP button** — always visible in robot mode in case anything goes squirrelly.
- **Demo mode** — works without an API key. Buddy uses a small offline phrasebook and a basic command parser, so the app is still playable while you set up the API.
- **Auto-installer** — `INSTALL.bat` installs Python automatically if missing.

The robot side runs in **dry-run** until you connect a paired mBot, so the app is fully usable for testing without the robot.

## Quick start on Nick's laptop

1. **Unzip** the `NicksRobotBuddy.zip` file.
2. **Double-click `INSTALL.bat`** in the unzipped folder.
   - If Python isn't installed, it auto-installs Python 3.12 via winget. Takes 1–2 minutes.
   - Then it sets up a virtual environment and installs `anthropic`, `pywebview`, `pyserial`.
3. **Double-click `RUN.bat`** to start. The app opens in **demo mode** so Nick can play immediately.

## Turn on the real AI brain (optional but recommended)

Demo mode is fun but limited. To unlock real conversations:

1. Get an Anthropic API key at <https://console.anthropic.com> (5 minutes, free trial credit).
2. Open Command Prompt and run:
   ```
   setx ANTHROPIC_API_KEY "sk-ant-...your-key-here..."
   ```
3. Close any open command windows and double-click `RUN.bat`. Buddy is now smart.

Cost: a few cents per session at most. To switch to the cheaper `claude-haiku-4-5` model, edit `backend/config.py` and change `CHAT_MODEL` and `ROBOT_MODEL`.

## Connecting the mBot over Bluetooth

1. Power on the mBot. Make sure the Bluetooth module is plugged in.
2. Open Windows **Settings → Bluetooth & devices** → Add device → Bluetooth.
3. Pair the device labeled `Makeblock` or `mBot`. PIN is usually `0000` or `1234`.
4. Once paired, Windows assigns it a **COM port** (e.g. `COM5`). Visible in Device Manager → Ports (COM & LPT).
5. In the app, switch to **Drive the Robot**, click the refresh button (↻), pick the COM port, and click **Connect**.

## Repackaging the app

If you change anything and want to re-ship to Nick's laptop, double-click `package.bat`. Produces `dist\NicksRobotBuddy.zip` ready to send.

## Safety notes

- Buddy's chat persona is locked to age-appropriate topics by a system prompt and refuses scary or grown-up subjects by redirecting.
- Robot motion is capped at 30 seconds total per command and 10 seconds per single action.
- The big red STOP button cuts motors and cancels speech instantly.

## Folder layout

```
NicksRobotBuddy/
├── backend/
│   ├── main.py            # pywebview window + JS bridge
│   ├── buddy_brain.py     # Anthropic API calls (chat + robot planner)
│   ├── demo_mode.py       # Offline phrasebook + rule-based robot parser
│   ├── robot_serial.py    # Makeblock byte protocol + dry-run
│   └── config.py          # System prompts, model IDs, safety limits
├── frontend/
│   ├── index.html         # Single-page UI with inline puppy SVG
│   ├── style.css          # Kid-friendly styling, paw prints, animations
│   └── app.js             # UI logic, Web Speech API, mouth-sync
├── INSTALL.bat            # First-time installer (auto-Python via winget)
├── RUN.bat                # Launcher
├── package.bat            # Repackager (produces dist/NicksRobotBuddy.zip)
└── requirements.txt
```

## Troubleshooting

- **Buddy is in demo mode forever** → `ANTHROPIC_API_KEY` isn't set in the user environment. Run the `setx` command above and reopen the app.
- **No COM ports listed** → mBot isn't paired yet, or Bluetooth is off. Repair from Windows Settings.
- **Voice mic doesn't work** → some embedded webviews block microphone access. Typing always works. If you want voice, check Windows Settings → Privacy → Microphone and ensure desktop apps can use it.
- **Robot drives backward when told "forward"** → flip `M2_INVERT` in `backend/robot_serial.py`.
- **WebView2 errors on launch** → install the Microsoft Edge WebView2 Runtime from <https://developer.microsoft.com/microsoft-edge/webview2/>. Should already be present on Windows 11.
