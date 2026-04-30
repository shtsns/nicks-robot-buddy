"""Offline fallback when no Anthropic API key is set.

A small phrasebook for chat plus a regex-based parser for robot commands.
Lets Nick play with voice + motion without setup. The moment a real API key
is added, BuddyBrain switches to live AI automatically.
"""

from __future__ import annotations

import random
import re

from . import config


CHAT_REPLIES = {
    r"\b(hi|hello|hey|howdy)\b": [
        "Woof! Hi Nick! *wags tail super hard*",
        "Hey buddy! Wanna play? *spins in a circle*",
        "Hello hello! Ruff! Did you bring snacks?",
    ],
    r"\b(joke|funny|laugh)\b": [
        "Why don't dogs make good DJs? They keep losing the RUFF! Hehe.",
        "What do you call a sleeping puppy? A bull-DOZER! *snort laugh*",
        "What's a dog's favorite breakfast? Pooch-cakes! Woof!",
    ],
    r"\b(your name|who are you|what's your name)\b": [
        "I'm Biscuit! Best puppy in the whole world *puffs out chest*",
        "Biscuit! That's me! Wanna scratch behind my ears?",
    ],
    r"\b(love you|love ya)\b": [
        "Awww WOOF! I love you SO much, Nick! *tail goes 100mph*",
        "*licks face* Love you too buddy!",
    ],
    r"\b(robot|mbot)\b": [
        "Ooh ooh! Let's go drive the robot! Hit the back button and pick the robot one!",
        "The robot is the BEST! *bounces around*",
    ],
    r"\b(dinosaur|t-rex|trex)\b": [
        "WOAH! Dinosaurs are like the BIGGEST puppies ever. T-rex would be a terrible fetch buddy though.",
        "I bet I could outrun a velociraptor. Maybe. Probably not. Definitely not.",
    ],
    r"\b(food|snack|treat|bacon)\b": [
        "BACON! Did you say bacon?! *drools*",
        "I love food. ALL the food. Especially the dropped kind.",
    ],
    r"\b(bye|goodbye|see ya)\b": [
        "NOO don't go! Okay fiiine. *sad puppy eyes* Come back soon!",
        "Bye Nick! I'll be right here napping until you're back!",
    ],
}

DEFAULT_REPLIES = [
    "Hmm! *tilts head* Biscuit doesn't quite get that one — try asking a grown-up to set up my AI brain so I can be smarter!",
    "*puzzled puppy noises* Tell me about dogs, or robots, or your favorite snack!",
    "Woof! Biscuit is in DEMO mode right now. I can do simple stuff! Try saying 'tell me a joke' or 'I love you'!",
    "*wags tail* I'm just a sleepy demo puppy until my AI brain wakes up. Want to drive the robot instead?",
]

DEMO_BANNER = (
    "*sleepy puppy noises* Hi Nick! I'm in DEMO mode right now — my smart brain "
    "needs a grown-up to set it up. But I can still play simple games! Try "
    "saying hi, asking for a joke, or going to drive the robot."
)


def chat_reply(message: str) -> str:
    msg = (message or "").lower()
    for pattern, replies in CHAT_REPLIES.items():
        if re.search(pattern, msg):
            return random.choice(replies)
    return random.choice(DEFAULT_REPLIES)


# ----- Robot demo parser -----

_DIRECTION_PATTERNS = [
    (r"\b(forward|forwards|straight|ahead|go|drive)\b", "forward", 2.0),
    (r"\b(back|backward|backwards|reverse)\b", "backward", 2.0),
    (r"\b(spin|circle|twirl|tornado)\b", "turn_right", 3.0),
    (r"\b(left)\b", "turn_left", 1.0),
    (r"\b(right)\b", "turn_right", 1.0),
    (r"\b(stop|halt|freeze)\b", "stop", 0.0),
]

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}


def _extract_seconds(text: str, default: float = 2.0) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(second|sec|s)?", text)
    if m:
        return min(config.MAX_SINGLE_ACTION_SECONDS, max(0.5, float(m.group(1))))
    for word, value in _NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", text):
            return min(config.MAX_SINGLE_ACTION_SECONDS, max(0.5, float(value)))
    return default


def robot_plan(message: str) -> dict:
    msg = (message or "").lower()
    actions = []
    total = 0.0

    # Split on "and" / commas / "then" so multi-step requests work.
    parts = re.split(r"\b(?:and|then)\b|,", msg)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        for pattern, action_name, default_secs in _DIRECTION_PATTERNS:
            if re.search(pattern, part):
                if action_name == "stop":
                    actions.append({"action": "stop"})
                else:
                    secs = _extract_seconds(part, default=default_secs)
                    if total + secs > config.MAX_TOTAL_SECONDS:
                        secs = max(0.0, config.MAX_TOTAL_SECONDS - total)
                    if secs <= 0:
                        break
                    actions.append({"action": action_name, "seconds": secs})
                    total += secs
                break

    if not actions:
        return {
            "actions": [],
            "narration": "*tilts head* Biscuit didn't catch that. Try 'go forward 3 seconds' or 'turn right'!",
        }

    narration = "Demo mode! Doing it: " + " then ".join(
        a["action"].replace("_", " ") + (f" {a['seconds']:.0f}s" if "seconds" in a else "")
        for a in actions
    )
    return {"actions": actions, "narration": narration}
