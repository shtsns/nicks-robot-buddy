"""Makeblock mBot v1 (mCore) serial protocol.

Protocol format for motor control:
    [0xFF 0x55] [len] [idx] [action] [device] [port] [speed_lo] [speed_hi]

    header   = 0xFF 0x55
    len      = 6 (count of bytes after this one, before checksum-less end)
    idx      = 0 (we don't track responses)
    action   = 0x02 (RUN)
    device   = 0x0A (DC motor on mCore — direct M1/M2, not RJ25)
    port     = 9 for M1, 10 for M2
    speed    = signed int16 little-endian, range -255..255

The mBot has two motors mounted facing opposite ways, so "forward" requires
sending positive speed to one and negative to the other. The default wiring
(M1 = right wheel, M2 = left wheel) tends to need M1 positive and M2 negative
to drive forward — but this varies by build, so the WHEEL_INVERT flags below
let you flip if needed without changing protocol code.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

try:
    import serial
    from serial.tools import list_ports
    PYSERIAL_AVAILABLE = True
except ImportError:
    PYSERIAL_AVAILABLE = False


PORT_M1 = 9
PORT_M2 = 10

# Flip if your robot drives backward when told to go forward.
M1_INVERT = False
M2_INVERT = True


def motor_packet(port: int, speed: int) -> bytes:
    speed = max(-255, min(255, int(speed)))
    speed_bytes = speed.to_bytes(2, "little", signed=True)
    return bytes([0xFF, 0x55, 0x06, 0x00, 0x02, 0x0A, port, speed_bytes[0], speed_bytes[1]])


def list_serial_ports() -> list[dict]:
    if not PYSERIAL_AVAILABLE:
        return []
    return [
        {"device": p.device, "description": p.description or p.device}
        for p in list_ports.comports()
    ]


@dataclass
class RobotAction:
    action: str
    seconds: float = 0.0


class RobotConnection:
    """Drives an mBot via serial. In dry-run mode, just logs what it would send."""

    def __init__(self, log_callback: Optional[Callable[[str], None]] = None):
        self._serial: Optional["serial.Serial"] = None
        self._port_name: Optional[str] = None
        self._lock = threading.Lock()
        self._stop_flag = threading.Event()
        self._log = log_callback or (lambda msg: None)

    @property
    def is_connected(self) -> bool:
        return self._serial is not None and self._serial.is_open

    @property
    def port_name(self) -> Optional[str]:
        return self._port_name if self.is_connected else None

    def connect(self, port: str) -> dict:
        if not PYSERIAL_AVAILABLE:
            return {"ok": False, "error": "pyserial is not installed"}
        with self._lock:
            try:
                if self._serial and self._serial.is_open:
                    self._serial.close()
                self._serial = serial.Serial(port, baudrate=115200, timeout=0.5)
                self._port_name = port
                self._log(f"connected to {port}")
                return {"ok": True, "port": port}
            except Exception as e:
                self._serial = None
                self._port_name = None
                return {"ok": False, "error": str(e)}

    def disconnect(self) -> None:
        with self._lock:
            if self._serial and self._serial.is_open:
                try:
                    self._send_raw(motor_packet(PORT_M1, 0))
                    self._send_raw(motor_packet(PORT_M2, 0))
                    self._serial.close()
                except Exception:
                    pass
            self._serial = None
            self._port_name = None
            self._log("disconnected")

    def _send_raw(self, data: bytes) -> None:
        if self._serial and self._serial.is_open:
            self._serial.write(data)
            self._serial.flush()

    def _drive(self, m1_speed: int, m2_speed: int) -> None:
        if M1_INVERT:
            m1_speed = -m1_speed
        if M2_INVERT:
            m2_speed = -m2_speed
        with self._lock:
            if self.is_connected:
                self._send_raw(motor_packet(PORT_M1, m1_speed))
                self._send_raw(motor_packet(PORT_M2, m2_speed))
            else:
                self._log(f"[dry-run] M1={m1_speed} M2={m2_speed}")

    def stop(self) -> None:
        self._stop_flag.set()
        self._drive(0, 0)
        self._log("STOP")

    def run_actions(self, actions: list[RobotAction], speed: int = 180) -> None:
        """Run a list of actions sequentially. Blocks the caller (run on a thread)."""
        self._stop_flag.clear()
        for act in actions:
            if self._stop_flag.is_set():
                break
            self._execute_one(act, speed)
        self._drive(0, 0)

    def _execute_one(self, act: RobotAction, speed: int) -> None:
        name = act.action
        secs = max(0.0, min(10.0, float(act.seconds or 0)))
        self._log(f"action: {name} ({secs}s)")

        if name == "forward":
            self._drive(speed, speed)
        elif name == "backward":
            self._drive(-speed, -speed)
        elif name == "turn_left":
            self._drive(-speed, speed)
        elif name == "turn_right":
            self._drive(speed, -speed)
        elif name == "stop":
            self._drive(0, 0)
            return
        else:
            self._log(f"unknown action: {name}")
            return

        end = time.monotonic() + secs
        while time.monotonic() < end:
            if self._stop_flag.is_set():
                break
            time.sleep(0.05)
        self._drive(0, 0)
