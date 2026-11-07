"""Probe the runner's desktop around the app's tray registration, on the bundle's own interpreter.

Windows only; elsewhere it prints one line and exits 0. It builds the icon with the app's own
``hqptuner.desktop.pystray_icon``, runs it with a setup that does what pystray's default setup does
(``icon.visible = True``), and records every ``Shell_NotifyIconW`` call pystray makes: the ``NIM_*`` code, the
fields, the return value, and for an add that returns 0 the last-error value read right after it on the same thread
(Microsoft calls that value unreliable for this function, so it is evidence and never a judgment on its own).

It also records the desktop the icon is registered on, as ``snapshot`` lines taken before ``icon.visible = True`` and
after each rung: the ``Shell_TrayWnd`` window and its ``TrayNotifyWnd`` child, every running ``explorer.exe``,
``WWAHost.exe``, ``StartMenuExperienceHost.exe`` and ``SystemPropertiesPerformance.exe`` with its session id, and
every top-level window ``IsWindowVisible`` reports visible with its class, title, owning image and DWM cloaked state.
A window counts as open when it is visible and not cloaked. The probe's own session id is printed with them.

Rung 1 waits, changing nothing, for an add pystray makes on its own (its ``TaskbarCreated`` re-add), then makes one
add of the probe's own with the values pystray's add carried. Rung 2 runs only when no add has succeeded: it stops,
by the PID the first snapshot recorded, each process that owns an open window of the three first-logon images, then
waits and adds as rung 1 did. Every add that succeeds is deleted right after it is recorded, so no icon stays
registered. It stops no other process, writes no registry key, and reads the desktop and the process table only.

Every exception is printed, never raised, and the exit status is 0, so the run is evidence and never changes a
job's result.
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
import time
from dataclasses import dataclass, field
from importlib.metadata import version
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable
    from types import ModuleType

NIM_ADD = 0
NIM_DELETE = 2
NIM_NAMES = {0: "NIM_ADD", 1: "NIM_MODIFY", 2: "NIM_DELETE", 3: "NIM_SETFOCUS", 4: "NIM_SETVERSION"}
NOTIFY = "Shell_NotifyIcon"
WATCHDOG_SECONDS = 90.0
RUNG_WAIT_SECONDS = 20.0
POLL_SECONDS = 0.5
DOCUMENTED_SIZE = 976
TIP_OFFSET = 40
TIP_BYTES = 256
FIRST_LOGON_IMAGES = ("wwahost.exe", "startmenuexperiencehost.exe", "systempropertiesperformance.exe")
WATCHED_IMAGES = ("explorer.exe", *FIRST_LOGON_IMAGES)
DWMWA_CLOAKED = 14
TH32CS_SNAPPROCESS = 2
PROCESS_TERMINATE = 1
TEXT_CHARS = 256
POINTER_FORMAT = "<Q"
INT_FORMAT = "<I"
ENUM_PROC = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)

log = logging.getLogger("probe")


class Icon(Protocol):
    """The part of a pystray icon the probe drives."""

    visible: bool

    def run(self, setup: Callable[[Icon], None]) -> None:
        """Run the message loop until ``stop``."""

    def stop(self) -> None:
        """End the message loop."""


class ProcessEntry(ctypes.Structure):
    """The ``PROCESSENTRY32W`` a Toolhelp snapshot walk fills in."""

    _fields_ = (
        ("dwSize", ctypes.c_uint32),
        ("cntUsage", ctypes.c_uint32),
        ("th32ProcessID", ctypes.c_uint32),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", ctypes.c_uint32),
        ("cntThreads", ctypes.c_uint32),
        ("th32ParentProcessID", ctypes.c_uint32),
        ("pcPriClassBase", ctypes.c_int32),
        ("dwFlags", ctypes.c_uint32),
        ("szExeFile", ctypes.c_wchar * 260),
    )


@dataclass(frozen=True)
class Add:
    """The values a ``NIM_ADD`` carries."""

    hwnd: int
    uid: int
    flags: int
    message: int
    icon: int
    tip: str


@dataclass(frozen=True)
class Process:
    """A running process the snapshot lists."""

    image: str
    pid: int
    session: int


@dataclass(frozen=True)
class Window:
    """A top-level window ``IsWindowVisible`` reports visible."""

    hwnd: int
    window_class: str
    title: str
    pid: int
    image: str
    cloaked: int | None

    @property
    def open(self) -> bool:
        """Visible and not DWM-cloaked."""
        return not self.cloaked


@dataclass(frozen=True)
class Snapshot:
    """The desktop at one moment."""

    label: str
    tray: int
    notify: int
    processes: list[Process]
    windows: list[Window]

    def first_logon_windows(self) -> list[Window]:
        """Return the open windows owned by a first-logon image."""
        return [w for w in self.windows if w.open and w.image.casefold() in FIRST_LOGON_IMAGES]


@dataclass
class Outcome:
    """What the setup saw."""

    setup_exception: bool = False
    own: dict[str, int | None] = field(default_factory=dict)
    stopped: list[int] = field(default_factory=list)
    initial: Snapshot | None = None
    watchdog: bool = False


def say(key: str, value: object) -> None:
    """Print one ``probe: key=value`` line."""
    print(f"probe: {key}={value}", flush=True)


def shown(handle: int) -> str:
    """Format a window handle, or ``none``."""
    return f"{handle:#x}" if handle else "none"


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


def report_interpreter() -> None:
    """Print the interpreter and the two libraries the bundle freezes."""
    say("machine", platform.machine())
    say("platform", platform.platform())
    say("pointer_bits", ctypes.sizeof(ctypes.c_void_p) * 8)
    say("python", sys.version.replace("\n", " "))
    say("pystray", version("pystray"))
    say("pillow", version("Pillow"))


class Desktop:
    """The read-only window and process queries the snapshots use, and the one stop by PID rung 2 makes."""

    def __init__(self, win32: ModuleType) -> None:
        """Load private handles to the system libraries, so no function pystray holds has its types changed."""
        self.user32 = win32.windll.LoadLibrary("user32")
        self.kernel32 = win32.windll.LoadLibrary("kernel32")
        self.dwmapi = win32.windll.LoadLibrary("dwmapi")
        handle, dword, text = ctypes.c_void_p, ctypes.c_uint32, ctypes.c_wchar_p
        types = (
            (self.user32.FindWindowW, ctypes.c_void_p, (text, text)),
            (self.user32.FindWindowExW, ctypes.c_void_p, (handle, handle, text, text)),
            (self.user32.EnumWindows, ctypes.c_int, (ENUM_PROC, handle)),
            (self.user32.IsWindowVisible, ctypes.c_int, (handle,)),
            (self.user32.GetClassNameW, ctypes.c_int, (handle, text, ctypes.c_int)),
            (self.user32.GetWindowTextW, ctypes.c_int, (handle, text, ctypes.c_int)),
            (self.user32.GetWindowThreadProcessId, dword, (handle, ctypes.POINTER(dword))),
            (self.dwmapi.DwmGetWindowAttribute, ctypes.c_int32, (handle, dword, handle, dword)),
            (self.kernel32.ProcessIdToSessionId, ctypes.c_int, (dword, ctypes.POINTER(dword))),
            (self.kernel32.CreateToolhelp32Snapshot, handle, (dword, dword)),
            (self.kernel32.Process32FirstW, ctypes.c_int, (handle, ctypes.POINTER(ProcessEntry))),
            (self.kernel32.Process32NextW, ctypes.c_int, (handle, ctypes.POINTER(ProcessEntry))),
            (self.kernel32.OpenProcess, handle, (dword, ctypes.c_int, dword)),
            (self.kernel32.TerminateProcess, ctypes.c_int, (handle, dword)),
            (self.kernel32.CloseHandle, ctypes.c_int, (handle,)),
        )
        for function, result, arguments in types:
            function.restype = result
            function.argtypes = arguments

    def last_error(self) -> int:
        """Return the calling thread's last-error value."""
        return int(self.kernel32.GetLastError())

    def session(self, pid: int) -> int:
        """Return a process's session id, or -1."""
        found = ctypes.c_uint32()
        return int(found.value) if self.kernel32.ProcessIdToSessionId(pid, ctypes.byref(found)) else -1

    def images(self) -> dict[int, str]:
        """Return every running process's image name by PID."""
        found: dict[int, str] = {}
        snap = self.kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        entry = ProcessEntry(dwSize=ctypes.sizeof(ProcessEntry))
        more = snap and self.kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while more:
            found[int(entry.th32ProcessID)] = str(entry.szExeFile)
            more = self.kernel32.Process32NextW(snap, ctypes.byref(entry))
        if snap:
            self.kernel32.CloseHandle(snap)
        return found

    def describe(self, hwnd: int, images: dict[int, str]) -> Window:
        """Read one window's class, title, owner and cloaked state."""
        window_class = ctypes.create_unicode_buffer(TEXT_CHARS)
        title = ctypes.create_unicode_buffer(TEXT_CHARS)
        pid = ctypes.c_uint32()
        cloaked = ctypes.c_uint32()
        self.user32.GetClassNameW(hwnd, window_class, TEXT_CHARS)
        self.user32.GetWindowTextW(hwnd, title, TEXT_CHARS)
        self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        known = self.dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ctypes.byref(cloaked), 4) == 0
        return Window(
            hwnd,
            window_class.value,
            title.value,
            pid.value,
            images.get(pid.value, "?"),
            cloaked.value if known else None,
        )

    def windows(self, images: dict[int, str]) -> list[Window]:
        """Return every top-level window ``IsWindowVisible`` reports visible."""
        handles: list[int] = []

        def collect(hwnd: int | None, _lparam: int | None) -> int:
            handles.append(hwnd or 0)
            return 1

        self.user32.EnumWindows(ENUM_PROC(collect), None)
        return [self.describe(h, images) for h in handles if self.user32.IsWindowVisible(h)]

    def snapshot(self, label: str) -> Snapshot:
        """Take the desktop's state: the tray window, the watched processes and the visible windows."""
        images = self.images()
        tray = self.user32.FindWindowW("Shell_TrayWnd", None) or 0
        notify = (self.user32.FindWindowExW(tray, None, "TrayNotifyWnd", None) or 0) if tray else 0
        watched = [
            Process(image, pid, self.session(pid))
            for pid, image in images.items()
            if image.casefold() in WATCHED_IMAGES
        ]
        return Snapshot(label, tray, notify, watched, self.windows(images))

    def stop(self, pid: int) -> str:
        """Terminate one process by PID and say what happened."""
        handle = self.kernel32.OpenProcess(PROCESS_TERMINATE, 0, pid)
        if not handle:
            return f"open_failed last_error={self.last_error()}"
        done = self.kernel32.TerminateProcess(handle, 1)
        self.kernel32.CloseHandle(handle)
        return f"terminated={bool(done)}"


def report_snapshot(snap: Snapshot) -> None:
    """Print a snapshot, one line per fact."""
    key = f"snapshot.{snap.label}"
    say(f"{key}.Shell_TrayWnd", shown(snap.tray))
    say(f"{key}.TrayNotifyWnd", shown(snap.notify))
    for p in snap.processes:
        say(f"{key}.process", f"image={p.image} pid={p.pid} session={p.session}")
    for w in snap.windows:
        say(
            f"{key}.window",
            f"hwnd={w.hwnd:#x} class={w.window_class!a} title={w.title!a} image={w.image} pid={w.pid}"
            f" cloaked={w.cloaked}",
        )
    open_ones = [f"{w.image}:{w.pid}:{w.title!a}" for w in snap.first_logon_windows()]
    say(f"{key}.first_logon_open", ", ".join(open_ones) or "none")


class Calls:
    """Stands in for ``pystray._util.win32.Shell_NotifyIcon``: forwards each call and prints what it carried."""

    def __init__(self, win32: ModuleType, desktop: Desktop) -> None:
        """Wrap pystray's call; no call has been seen yet."""
        self.original: Callable[[int, object], int] = win32.Shell_NotifyIcon
        self.structure: type[ctypes.Structure] = win32.NOTIFYICONDATAW
        self.desktop = desktop
        self.lock = threading.Lock()
        self.started = time.monotonic()
        self.rung = "initial"
        self.first_success: str | None = None
        self.pystray_adds: list[tuple[Add, int]] = []

    def __call__(self, code: int, data: ctypes.Structure) -> int:
        """Forward a call made by pystray, whose ``data`` is its ``NOTIFYICONDATAW``."""
        add = view_add(data)
        result = self.forward("pystray", code, add, data, ctypes.sizeof(data))
        if code == NIM_ADD:
            self.pystray_adds.append((add, result))
            if result:
                self.delete(add)
        return result

    def forward(self, source: str, code: int, add: Add, argument: object, size: int) -> int:
        """Make the call, print it with its time, rung and return value, and return that value."""
        result = int(self.original(code, argument))
        failure = f" last_error={self.desktop.last_error()}" if code == NIM_ADD and not result else ""
        with self.lock:
            if code == NIM_ADD and result and self.first_success is None:
                self.first_success = f"{self.rung}/{source}"
            say(
                "call",
                f"t={time.monotonic() - self.started:.1f} rung={self.rung} source={source}"
                f" code={NIM_NAMES.get(code, code)}"
                f" cbSize={size} hWnd={add.hwnd:#x} uID={add.uid} uFlags={add.flags:#x} returned={result}{failure}",
            )
        return result

    def delete(self, add: Add) -> None:
        """Remove a registered icon with pystray's own structure."""
        data = self.structure(cbSize=ctypes.sizeof(self.structure), hWnd=add.hwnd, uID=add.uid, uFlags=0)
        self.forward("probe", NIM_DELETE, add, data, ctypes.sizeof(data))


def wait_for_add(calls: Calls, outcome: Outcome) -> None:
    """Wait up to the rung's time for any add to succeed, polling; return at once if one already has."""
    deadline = time.monotonic() + RUNG_WAIT_SECONDS
    while time.monotonic() < deadline and not outcome.watchdog and calls.first_success is None:
        time.sleep(POLL_SECONDS)


def own_add(win32: ModuleType, calls: Calls, outcome: Outcome) -> None:
    """Make one add of the probe's own with the values pystray's first add carried, and delete it if it succeeds."""
    if not calls.pystray_adds:
        say(f"{calls.rung}.own_add", "not run: pystray made no NIM_ADD")
        return
    add = calls.pystray_adds[0][0]
    argument = ctypes.cast(documented_buffer(add), win32.LPNOTIFYICONDATAW)
    result = calls.forward("probe", NIM_ADD, add, argument, DOCUMENTED_SIZE)
    outcome.own[calls.rung] = result
    if result:
        calls.forward("probe", NIM_DELETE, add, argument, DOCUMENTED_SIZE)


def run_rung(win32: ModuleType, desktop: Desktop, calls: Calls, outcome: Outcome, rung: str) -> None:
    """Wait, add the probe's own icon, and take a snapshot, all recorded under ``rung``."""
    calls.rung = rung
    began = time.monotonic()
    wait_for_add(calls, outcome)
    say(f"{rung}.waited_seconds", f"{time.monotonic() - began:.1f}")
    own_add(win32, calls, outcome)
    report_snapshot(desktop.snapshot(f"after_{rung}"))


def stop_first_logon(desktop: Desktop, calls: Calls, outcome: Outcome) -> None:
    """Stop, by PID, each process the first snapshot showed owning an open window of a first-logon image."""
    calls.rung = "rung2"
    pids = sorted({w.pid for w in outcome.initial.first_logon_windows()}) if outcome.initial else []
    for pid in pids:
        outcome.stopped.append(pid)
        say("rung2.stop", f"pid={pid} {desktop.stop(pid)}")
    if not pids:
        say("rung2.stop", "none: the first snapshot showed no open first-logon window")


def make_setup(win32: ModuleType, desktop: Desktop, calls: Calls, outcome: Outcome) -> Callable[[Icon], None]:
    """Build the setup callback: snapshot, pystray's default action, rung 1, rung 2 if nothing succeeded, stop."""

    def setup(icon: Icon) -> None:
        try:
            say("session", desktop.session(os.getpid()))
            outcome.initial = desktop.snapshot("initial")
            report_snapshot(outcome.initial)
            try:
                icon.visible = True
            except Exception:
                outcome.setup_exception = True
                log.exception("setup: icon.visible = True raised")
            run_rung(win32, desktop, calls, outcome, "rung1")
            if calls.first_success is None:
                stop_first_logon(desktop, calls, outcome)
                run_rung(win32, desktop, calls, outcome, "rung2")
        except Exception:
            log.exception("setup: probe step raised")
        finally:
            icon.stop()

    return setup


def summarize(desktop: Desktop, calls: Calls, outcome: Outcome) -> str:
    """Build the summary line's value."""
    mine = desktop.session(os.getpid())
    explorers = [
        p for p in (outcome.initial.processes if outcome.initial else []) if p.image.casefold() == "explorer.exe"
    ]
    shared = any(p.session == mine for p in explorers)
    first = calls.pystray_adds[0][1] if calls.pystray_adds else "none"
    return (
        f"setup_exception={outcome.setup_exception} pystray_first_add={first}"
        f" first_success={calls.first_success or 'none'}"
        f" own_rung1={outcome.own.get('rung1', 'not run')} own_rung2={outcome.own.get('rung2', 'not run')}"
        f" stopped={outcome.stopped or 'none'} explorer_in_probe_session={shared} watchdog_fired={outcome.watchdog}"
    )


def run() -> None:
    """Run the icon under the recorder and print the summary."""
    report_interpreter()
    win32 = importlib.import_module("pystray._util.win32")
    desktop_module = importlib.import_module("hqptuner.desktop")
    desktop = Desktop(win32)
    calls = Calls(win32, desktop)
    setattr(win32, NOTIFY, calls)
    icon: Icon = desktop_module.pystray_icon(lambda: None, lambda: None)
    outcome = Outcome()

    def expire() -> None:
        outcome.watchdog = True
        icon.stop()

    watchdog = threading.Timer(WATCHDOG_SECONDS, expire)
    watchdog.daemon = True
    watchdog.start()
    icon.run(make_setup(win32, desktop, calls, outcome))
    watchdog.cancel()
    say("summary", summarize(desktop, calls, outcome))


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
