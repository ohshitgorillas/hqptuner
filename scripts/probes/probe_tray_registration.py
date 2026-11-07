"""Probe what the app's tray registration hands to ``Shell_NotifyIconW``, on the bundle's own interpreter.

Windows only; elsewhere it prints one line and exits 0. It builds the icon with the app's own
``hqptuner.desktop.pystray_icon``, runs it with a setup that does what pystray's default setup does
(``icon.visible = True``), and records every ``Shell_NotifyIconW`` call pystray makes: the ``NIM_*`` code, the
fields, the return value. The first call is ``_update_icon``'s ``NIM_MODIFY``, which returns 0 because no icon
exists yet; the ``NIM_ADD`` after it is the registration.

It then records pystray's ``NOTIFYICONDATAW`` size and field offsets beside the documented 64-bit layout, and makes
one add of its own that carries the values pystray's add carried, in a 976-byte buffer filled at the documented
offsets by arithmetic, independent of ctypes' structure layout. The byte ranges where pystray's structure and that
buffer differ are printed by field name.

Its only shell32 calls are the notify adds and deletes the app's own tray path makes. It finds, enumerates and
queries no shell window or process and reads no registry key. Every exception is printed, never raised, and the
exit status is 0, so the run is evidence and never changes a job's result. No icon stays registered.
"""

from __future__ import annotations

import ctypes
import importlib
import logging
import os
import platform
import struct
import sys
import threading
from dataclasses import dataclass
from importlib.metadata import version
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable
    from types import ModuleType

NIM_ADD = 0
NIM_DELETE = 2
NIM_NAMES = {0: "NIM_ADD", 1: "NIM_MODIFY", 2: "NIM_DELETE", 3: "NIM_SETFOCUS", 4: "NIM_SETVERSION"}
NOTIFY = "Shell_NotifyIcon"
WATCHDOG_SECONDS = 30.0
DOCUMENTED_SIZE = 976
TIP_OFFSET = 40
TIP_BYTES = 256
SHOWN_BYTES = 16

# (name, offset, size) of the documented 64-bit NOTIFYICONDATAW, from Microsoft's field order and type sizes.
DOCUMENTED = (
    ("cbSize", 0, 4),
    ("hWnd", 8, 8),
    ("uID", 16, 4),
    ("uFlags", 20, 4),
    ("uCallbackMessage", 24, 4),
    ("hIcon", 32, 8),
    ("szTip", 40, 256),
    ("dwState", 296, 4),
    ("dwStateMask", 300, 4),
    ("szInfo", 304, 512),
    ("uVersion", 816, 4),
    ("szInfoTitle", 820, 128),
    ("dwInfoFlags", 948, 4),
    ("guidItem", 952, 16),
    ("hBalloonIcon", 968, 8),
)
POINTER_FORMAT = "<Q"
INT_FORMAT = "<I"

log = logging.getLogger("probe")


class Icon(Protocol):
    """The part of a pystray icon the probe drives."""

    visible: bool

    def run(self, setup: Callable[[Icon], None]) -> None:
        """Run the message loop until ``stop``."""

    def stop(self) -> None:
        """End the message loop."""


@dataclass(frozen=True)
class Add:
    """The values a ``NIM_ADD`` carries."""

    hwnd: int
    uid: int
    flags: int
    message: int
    icon: int
    tip: str


def say(key: str, value: object) -> None:
    """Print one ``probe: key=value`` line."""
    print(f"probe: {key}={value}", flush=True)


def view_add(data: ctypes.Structure) -> Add:
    """Read the add's values through pystray's own structure."""
    return Add(
        hwnd=int(data.hWnd or 0),
        uid=int(data.uID),
        flags=int(data.uFlags),
        message=int(data.uCallbackMessage),
        icon=int(data.hIcon or 0),
        tip=str(data.szTip),
    )


def documented_buffer(add: Add) -> ctypes.Array[ctypes.c_char]:
    """Fill a 976-byte buffer at the documented offsets with the add's values."""
    buf = ctypes.create_string_buffer(DOCUMENTED_SIZE)
    struct.pack_into(INT_FORMAT, buf, 0, DOCUMENTED_SIZE)
    struct.pack_into(POINTER_FORMAT, buf, 8, add.hwnd)
    struct.pack_into(INT_FORMAT, buf, 16, add.uid)
    struct.pack_into(INT_FORMAT, buf, 20, add.flags)
    struct.pack_into(INT_FORMAT, buf, 24, add.message)
    struct.pack_into(POINTER_FORMAT, buf, 32, add.icon)
    tip = add.tip.encode("utf-16-le")[: TIP_BYTES - 2]
    struct.pack_into(f"<{len(tip)}s", buf, TIP_OFFSET, tip)
    return buf


def view_buffer(raw: bytes) -> Add:
    """Read the add's values back from a buffer at the documented offsets."""
    (hwnd,) = struct.unpack_from(POINTER_FORMAT, raw, 8)
    uid, flags, message = struct.unpack_from("<3I", raw, 16)
    (icon,) = struct.unpack_from(POINTER_FORMAT, raw, 32)
    tip = raw[TIP_OFFSET : TIP_OFFSET + TIP_BYTES].decode("utf-16-le").split("\0", 1)[0]
    return Add(hwnd=hwnd, uid=uid, flags=flags, message=message, icon=icon, tip=tip)


def spans() -> list[tuple[str, int, int]]:
    """Return the documented fields and the padding between them, as (name, start, end)."""
    out: list[tuple[str, int, int]] = []
    cursor = 0
    for name, offset, size in DOCUMENTED:
        if offset > cursor:
            out.append((f"padding@{cursor}", cursor, offset))
        out.append((name, offset, offset + size))
        cursor = offset + size
    if cursor < DOCUMENTED_SIZE:
        out.append((f"padding@{cursor}", cursor, DOCUMENTED_SIZE))
    return out


def first_difference(theirs: bytes, ours: bytes) -> int:
    """Return the index of the first byte where two byte strings differ, or the shorter length when one is a prefix."""
    return next((i for i, (a, b) in enumerate(zip(theirs, ours, strict=False)) if a != b), min(len(theirs), len(ours)))


def differing(theirs: bytes, ours: bytes) -> list[str]:
    """Name each documented field or padding range whose bytes differ, and any bytes past the documented size.

    A range of up to 16 bytes shows both byte strings; a longer one shows the offset of its first differing byte.
    """
    found: list[str] = []
    for name, start, end in spans():
        a, b = theirs[start:end], ours[start:end]
        if a == b:
            continue
        shown = (
            f"pystray={a.hex()} documented={b.hex()}"
            if end - start <= SHOWN_BYTES
            else (f"first_difference_at={start + first_difference(a, b)}")
        )
        found.append(f"{name}[{start}:{end}] {shown}")
    if len(theirs) != len(ours):
        found.append(f"size pystray={len(theirs)} documented={len(ours)}")
    return found


def report_layout(cls: type[ctypes.Structure]) -> None:
    """Print pystray's structure size and field offsets beside the documented ones."""
    say("layout.sizeof", f"pystray={ctypes.sizeof(cls)} documented={DOCUMENTED_SIZE}")
    for name, offset, size in DOCUMENTED:
        field = getattr(cls, name, None)
        say(
            f"layout.{name}",
            f"pystray_offset={getattr(field, 'offset', 'absent')} documented_offset={offset}"
            f" pystray_size={getattr(field, 'size', 'absent')} documented_size={size}",
        )


def report_interpreter() -> None:
    """Print the interpreter and the two libraries the bundle freezes."""
    say("machine", platform.machine())
    say("platform", platform.platform())
    say("pointer_bits", ctypes.sizeof(ctypes.c_void_p) * 8)
    say("python", sys.version.replace("\n", " "))
    say("pystray", version("pystray"))
    say("pillow", version("Pillow"))


class Calls:
    """Stands in for ``pystray._util.win32.Shell_NotifyIcon``: forwards each call and prints what it carried."""

    def __init__(self, original: Callable[[int, object], int]) -> None:
        """Wrap ``original``; no call has been seen yet."""
        self.original = original
        self.lock = threading.Lock()
        self.pystray_adds: list[tuple[Add, bytes, int]] = []

    def __call__(self, code: int, data: ctypes.Structure) -> int:
        """Forward a call made by pystray, whose ``data`` is its ``NOTIFYICONDATAW``."""
        raw = ctypes.string_at(ctypes.addressof(data), ctypes.sizeof(data))
        add = view_add(data)
        result = self.forward("pystray", code, add, data, ctypes.sizeof(data))
        if code == NIM_ADD:
            self.pystray_adds.append((add, raw, result))
        return result

    def forward(self, source: str, code: int, add: Add, argument: object, size: int) -> int:
        """Make the call, print its code, fields, structure size and return value, and return that value."""
        result = int(self.original(code, argument))
        with self.lock:
            say(
                "call",
                f"source={source} code={NIM_NAMES.get(code, code)} cbSize={size} hWnd={add.hwnd:#x} uID={add.uid}"
                f" uFlags={add.flags:#x} returned={result}",
            )
        return result


@dataclass
class Outcome:
    """What the setup saw."""

    setup_exception: bool = False
    documented_add: int | None = None
    differences: list[str] | None = None
    watchdog: bool = False


def delete_pystray_add(win32: ModuleType, calls: Calls, add: Add) -> None:
    """Remove pystray's registered icon with pystray's own structure."""
    cls = win32.NOTIFYICONDATAW
    data = cls(cbSize=ctypes.sizeof(cls), hWnd=add.hwnd, uID=add.uid, uFlags=0)
    calls.forward("probe", NIM_DELETE, add, data, ctypes.sizeof(data))


def documented_round(win32: ModuleType, calls: Calls, add: Add, theirs: bytes, outcome: Outcome) -> None:
    """Add and delete one icon from the documented buffer, and print where it differs from pystray's structure."""
    buf = documented_buffer(add)
    ours = bytes(buf)
    outcome.differences = differing(theirs, ours)
    for line in outcome.differences or ["none"]:
        say("differs", line)
    argument = ctypes.cast(buf, win32.LPNOTIFYICONDATAW)
    outcome.documented_add = calls.forward("probe", NIM_ADD, view_buffer(ours), argument, DOCUMENTED_SIZE)
    calls.forward("probe", NIM_DELETE, view_buffer(ours), argument, DOCUMENTED_SIZE)


def make_setup(win32: ModuleType, calls: Calls, outcome: Outcome) -> Callable[[Icon], None]:
    """Build the setup callback: pystray's default action, then the documented round, then stop."""

    def setup(icon: Icon) -> None:
        try:
            try:
                icon.visible = True
            except Exception:
                outcome.setup_exception = True
                log.exception("setup: icon.visible = True raised")
            if calls.pystray_adds:
                add, theirs, result = calls.pystray_adds[0]
                if result:
                    delete_pystray_add(win32, calls, add)
                documented_round(win32, calls, add, theirs, outcome)
            else:
                say("documented_round", "not run: pystray made no NIM_ADD")
        except Exception:
            log.exception("setup: probe step raised")
        finally:
            icon.stop()

    return setup


def run() -> None:
    """Run the icon under the recorder and print the summary."""
    report_interpreter()
    win32 = importlib.import_module("pystray._util.win32")
    desktop = importlib.import_module("hqptuner.desktop")
    report_layout(win32.NOTIFYICONDATAW)
    calls = Calls(win32.Shell_NotifyIcon)
    setattr(win32, NOTIFY, calls)
    icon: Icon = desktop.pystray_icon(lambda: None, lambda: None)
    outcome = Outcome()

    def expire() -> None:
        outcome.watchdog = True
        icon.stop()

    watchdog = threading.Timer(WATCHDOG_SECONDS, expire)
    watchdog.daemon = True
    watchdog.start()
    icon.run(make_setup(win32, calls, outcome))
    watchdog.cancel()
    first = calls.pystray_adds[0][2] if calls.pystray_adds else "none"
    say(
        "summary",
        f"setup_exception={outcome.setup_exception} pystray_add={first} documented_add={outcome.documented_add}"
        f" differing_fields={len(outcome.differences) if outcome.differences is not None else 'not run'}"
        f" watchdog_fired={outcome.watchdog}",
    )


def main() -> int:
    """Run the probe on Windows and return 0 whatever happens."""
    if sys.platform != "win32":
        say("skipped", "this probe runs on Windows")
        return 0
    try:
        run()
    except Exception:
        log.exception("probe raised")
    return 0


if __name__ == "__main__":
    logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="probe: %(levelname)s %(message)s")
    status = main()
    sys.stdout.flush()
    # pystray's setup thread is not a daemon: a hang before the loop starts would hold the process open.
    os._exit(status)
