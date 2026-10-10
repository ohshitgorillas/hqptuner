"""HQPlayer Control API (TCP 4321) client.

Wire behavior per docs/protocol.md §1/§4: each request is a complete XML
document; responses are XML documents with newline as a flush hint, so the
receiver accumulates and parses until a document is valid. Lenient in both
directions: bare '&' in attribute values is re-escaped before parsing
(hqpexporter-observed daemon quirk), and entity-escaped-twice attribute
values are unescaped once more after parsing (reference-client behavior).
"""

import asyncio
import contextlib
import logging
import re
import socket
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Iterator
from dataclasses import dataclass
from typing import Protocol

from hqptuner.engine.controlerrors import (
    CommandError,
    CommandRefusedError,
    ConnectionClosedError,
    ControlConnectionFailedError,
    ControlError,
    ControlTimeoutError,
    ResponseTooLargeError,
    StateMismatchError,
)
from hqptuner.engine.frames import parse_frame

log = logging.getLogger(__name__)

XML_HDR = '<?xml version="1.0" encoding="UTF-8"?>'
MAX_RESPONSE = 4 * 1024 * 1024

ENUM_COMMANDS = {
    "modes": "GetModes",
    "filters": "GetFilters",
    "shapers": "GetShapers",
    "rates": "GetRates",
    "junk_filters": "GetJunkFilters",
}


class Deadline(Protocol):
    """What the client waits on a reply under. The ``asyncio`` module itself is one, and the production default."""

    def wait_for[T](self, fut: Awaitable[T], timeout: float, /) -> Awaitable[T]:
        """Answer ``fut``'s own result, or raise ``TimeoutError`` when ``timeout`` seconds pass first."""
        ...


@dataclass(frozen=True)
class Reply:
    """A setter's answer as the daemon gave it: the command, its ``result`` attribute, and its reason text."""

    element: str
    result: str | None
    text: str

    @property
    def ok(self) -> bool:
        """Whether the daemon accepted it: result="OK", or absent (SetAdaptiveVolume quirk, protocol.md §6)."""
        return self.result is None or self.result == "OK"

    def refusal(self) -> CommandRefusedError | None:
        """Return the refusal this reply carries, or None when the daemon accepted the command."""
        if self.result is None or self.ok:
            return None
        return CommandRefusedError(element_name=self.element, result=self.result, text=self.text)


def _reply(element_name: str, root: ET.Element) -> Reply:
    """Read ``root``, the daemon's answer to ``element_name``, as a ``Reply``: its ``result`` and its reason text."""
    return Reply(element_name, root.get("result"), (root.text or "").strip())


def state_mismatch_of(expected: dict[str, str], state: dict[str, str]) -> StateMismatchError | None:
    """Return the mismatch of the ``state`` read back against ``expected``, or None when every attribute matches."""
    mismatch = {k: (want, state.get(k)) for k, want in expected.items() if state.get(k) != want}
    return StateMismatchError(mismatch=mismatch) if mismatch else None


def _element_name(element: str) -> str:
    """Extract the command name out of a request document, for error messages."""
    match = re.match(r"<([A-Za-z][\w-]*)", element)
    return match.group(1) if match is not None else "request"


class ControlClient:
    """One Control API connection, with a lock serializing request/response round trips over it."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 4321,
        timeout: float = 5.0,
        *,
        deadline: Deadline = asyncio,
    ):
        """Record where to dial and how long to wait; no socket is opened until ``connect``.

        ``deadline`` is what every connect, send and read waits under (docs/testing.md rule 7).
        """
        self._host = host
        self._port = port
        self._timeout = timeout
        self._deadline = deadline
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """Open the TCP connection and turn on SO_KEEPALIVE so a silently dead daemon surfaces as a socket error."""
        # a refused reconnect repeats every poll while HQPlayer is down, and the
        # manager already logs the drop once
        with self._as_control_error("connect", level=logging.DEBUG):
            reader, writer = await self._deadline.wait_for(
                asyncio.open_connection(self._host, self._port), self._timeout
            )
        self._reader, self._writer = reader, writer
        sock = writer.get_extra_info("socket")
        if sock is not None:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)

    @contextlib.contextmanager
    def _as_control_error(self, what: str, *, level: int = logging.WARNING) -> Iterator[None]:
        """Raw socket failures as ``ControlError``, which is what callers handle.

        ``asyncio.wait_for`` raises a bare ``TimeoutError`` and a dead transport
        raises ``OSError``; neither is a ``ControlError``, so a caller that handles
        ``ControlError`` would not catch them. This turns a timeout into
        ``ControlTimeoutError`` and an ``OSError`` into the unreachable error, so
        ``writer._apply_one`` can record the setting as failed and the API answers
        with a body.
        """
        try:
            yield
        except (TimeoutError, OSError, ControlError) as exc:
            # Which command died is the whole diagnostic — a daemon that drops the
            # connection under `SetFilter` fails some LATER command — and a timeout,
            # a closed connection or an unreachable daemon reaches the user naming
            # no command, so for those the log is where that pairing survives.
            log.log(level, "Control API %s failed: %r", what, exc)
            if isinstance(exc, TimeoutError):
                raise ControlTimeoutError(timeout=self._timeout) from exc
            if isinstance(exc, OSError):
                raise self._unreachable() from exc
            raise

    def _unreachable(self) -> ControlConnectionFailedError:
        """Build the failure a command meets when there is no connection to send it on."""
        return ControlConnectionFailedError(host=self._host, port=self._port)

    async def close(self) -> None:
        """Close the connection and forget the streams, ignoring a transport that has already failed."""
        if self._writer is not None:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except OSError:
                pass
            self._reader = self._writer = None

    async def request(self, element: str) -> ET.Element:
        """Send one XML command document, return the parsed response root."""
        async with self._lock:
            # Read under the lock, not before it: the request in flight ahead of
            # this one closes the connection when it fails (below), and the poll
            # loop's `_drop` closes it from outside, so a writer checked while
            # queueing is a writer that can be gone by the time the lock is held.
            writer = self._writer
            command = _element_name(element)
            # covers the receive too: `_recv_document`'s own read deadline is the
            # one a stalled command trips, and it is this command's name that says
            # which command stalled
            with self._as_control_error(command):
                if writer is None:
                    raise self._unreachable()
                try:
                    writer.write((XML_HDR + element).encode())
                    await self._deadline.wait_for(writer.drain(), self._timeout)
                    return await self._recv_document(command)
                except (TimeoutError, OSError, ControlError):
                    # The daemon answers every command it accepts, unknown ones
                    # included (protocol.md §4), so a reply given up on is a reply
                    # still to come. Left on an open socket it becomes the answer
                    # the NEXT command reads: `set_command` checks the root's
                    # `result` and not which element it is, so a stale OK passes
                    # for a setter that was never acknowledged. Drop the
                    # connection instead and let the poll loop reconnect. A
                    # `CommandError` is not raised here — a refusal is a complete,
                    # correctly paired document, and that connection stays.
                    await self.close()
                    raise

    async def _recv_document(self, command: str) -> ET.Element:
        reader = self._reader
        if reader is None:
            raise self._unreachable()
        data = b""
        while True:
            chunk = await self._deadline.wait_for(reader.read(65536), self._timeout)
            if not chunk:
                raise ConnectionClosedError()
            data += chunk
            text = data.decode("utf-8", errors="replace")
            body = text.split("?>", 1)[-1].strip() if "?>" in text else text.strip()
            if body:
                frame = parse_frame(body, command)
                if frame is not None:
                    return frame
            if len(data) > MAX_RESPONSE:
                raise ResponseTooLargeError(command=command, limit=MAX_RESPONSE)

    # --- typed helpers -------------------------------------------------

    async def _attrs(self, element: str) -> dict[str, str]:
        """Run a query whose whole answer is the response root's attributes."""
        return dict((await self.request(element)).attrib)

    async def get_info(self) -> dict[str, str]:
        """Run `<GetInfo/>` for {name, product, version, platform, engine} — also the reachability handshake."""
        return await self._attrs("<GetInfo/>")

    async def get_license(self) -> dict[str, str]:
        """Run `<GetLicense/>` for the static license attributes: `valid` (0/1), `name` (licensee), `fingerprint`."""
        return await self._attrs("<GetLicense/>")

    async def get_active_config(self) -> str:
        """Return the active configuration/preset name.

        An empty string is the unnamed ``[default]`` base. Response carries the name in the ``value`` attribute.
        """
        return (await self.request("<ConfigurationGet/>")).attrib.get("value", "")

    async def get_state(self) -> dict[str, str]:
        """Run `<State/>` for the settings snapshot — the primary readback, settings as list indices (protocol.md §6).

        Numeric attributes are list indices into the corresponding enumeration, not enum IDs; `volume` is dB and
        `matrix_profile` a name. A refused State is no snapshot, so it raises HQPlayer's refusal instead.
        """
        state, refused = await self.state_readback()
        if refused is not None:
            raise refused
        return state

    async def state_unless_refused(self) -> dict[str, str] | None:
        """Run `<State/>` for the settings snapshot, or None when HQPlayer refuses the read.

        A refusal is a complete, correctly paired answer, so the connection stands and the reading held before it is
        the caller's to keep.
        """
        state, refused = await self.state_readback()
        if refused is not None:
            log.warning("State read refused, keeping the last reading: %s", refused)
            return None
        return state

    async def get_volume_range(self) -> dict[str, str]:
        """`<VolumeRange/>` -> {min, max, enabled, adaptive} (dB doubles + flags).

        The authority for live-volume slider bounds and whether volume control is active at all (protocol.md §6,
        "Volume commands").
        """
        return await self._attrs("<VolumeRange/>")

    async def get_status(self) -> tuple[dict[str, str], dict[str, str] | None]:
        """Run one-shot `<Status subscribe="0"/>`, returning the root attributes and the `metadata` child's, if present.

        Status reports the *active* filter/shaper/mode as display strings where State reports configured list indices
        (protocol.md §6); `metadata` is present only while a track is loaded.
        """
        root = await self.request('<Status subscribe="0"/>')
        meta = root.find("metadata")
        return dict(root.attrib), (dict(meta.attrib) if meta is not None else None)

    async def set_matrix_profile(self, name: str) -> None:
        """`<MatrixSetProfile value="..."/>` — live matrix-profile switch (empty = the unnamed [Default]).

        Probe-verified on 6.0.4: unauthenticated, zero reload, playback uninterrupted; memory-only, reverts on daemon
        restart (docs/matrix-spec.md probe findings).
        """
        await self.set_command("MatrixSetProfile", value=name)

    async def get_matrix_profiles(self) -> list[str]:
        """`<MatrixListProfiles/>` -> saved matrix profile names (`MatrixProfile` children).

        Verified live on 6.0.4 (docs/matrix-spec.md probe findings): unauthenticated, live lane, no reload.
        """
        root = await self.request("<MatrixListProfiles/>")
        return [item.attrib.get("name", "") for item in root]

    async def get_enumeration(self, command: str) -> list[dict[str, str]]:
        """Run one `Get*` enumeration command and return each child item's attributes, in the engine's own order.

        Filter, shaper and rate lists are mode-dependent — re-enumerate after a mode change, since indices shift.
        """
        root = await self.request(f"<{command}/>")
        return [dict(item.attrib) for item in root]

    async def get_all_enumerations(self) -> dict[str, list[dict[str, str]]]:
        """Run every command in `ENUM_COMMANDS` in turn, keyed by its short name (modes, filters, shapers, ...)."""
        return {key: await self.get_enumeration(cmd) for key, cmd in ENUM_COMMANDS.items()}

    async def send(self, element_name: str, **attrs: str) -> Reply:
        """Send one setter and return the daemon's answer to it, accepted or refused.

        Note result="OK" is not proof of application — callers verify by State readback (protocol.md §6 caveat).
        """
        attr_str = "".join(f' {k}="{v}"' for k, v in attrs.items())
        root = await self.request(f"<{element_name}{attr_str}/>")
        return _reply(element_name, root)

    async def set_command(self, element_name: str, **attrs: str) -> None:
        """Setter with result check: a refusal (result="Error") raises with the reason."""
        refused = (await self.send(element_name, **attrs)).refusal()
        if refused is not None:
            raise refused

    # --- typed setters (index domain; protocol.md §6) ------------------
    #
    # Only the settings whose call is more than "one value attribute, one State
    # attribute" live here. The uniform ones (mode, shaper, rate, junk filter,
    # adaptive volume) are rows in ``writer.SETTINGS`` driving ``set_command``
    # directly — a wrapper per setting was a second place for the element name
    # to be spelled, and spelling it twice is how it drifts.

    async def send_filter(self, nx: str, x1: str | None = None) -> Reply:
        """`value` alone sets both 1x and Nx; `value1x` splits them (Nx=value, 1x=value1x).

        Reference client omits value1x when the 1x arg is < 0.
        """
        if x1 is None:
            return await self.send("SetFilter", value=nx)
        return await self.send("SetFilter", value=nx, value1x=x1)

    async def set_filter(self, nx: str, x1: str | None = None) -> None:
        """Set the filter pair (``send_filter``), raising the daemon's refusal."""
        refused = (await self.send_filter(nx, x1)).refusal()
        if refused is not None:
            raise refused

    async def send_volume(self, db: str) -> Reply:
        """Send absolute volume in dB via `<Volume value="..."/>`; refused when `VolumeRange` reports `enabled="0"`."""
        return await self.send("Volume", value=db)

    async def set_volume(self, db: str) -> None:
        """Set absolute volume in dB, raising the daemon's refusal."""
        refused = (await self.send_volume(db)).refusal()
        if refused is not None:
            raise refused

    async def state_readback(self) -> tuple[dict[str, str], CommandRefusedError | None]:
        """Run `<State/>` to verify a setter: the settings snapshot, and HQPlayer's refusal of the read, if it refused.

        A refused State answers ``result="Error"`` with its diagnostic as the element's text, so its attributes are
        no snapshot to compare against.
        """
        root = await self.request("<State/>")
        return dict(root.attrib), _reply("State", root).refusal()

    async def state_mismatch(self, expected: dict[str, str]) -> CommandError | None:
        """Re-read State and return HQPlayer's refusal of the read, else the mismatch against ``expected``.

        None when every attribute matches. result="OK" is not proof of application (protocol.md §6) — this is.
        """
        state, refused = await self.state_readback()
        if refused is not None:
            return refused
        return state_mismatch_of(expected, state)

    async def verify_state(self, expected: dict[str, str]) -> None:
        """Re-read State and raise unless every expected attribute matches."""
        mismatch = await self.state_mismatch(expected)
        if mismatch is not None:
            raise mismatch
