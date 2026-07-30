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
from collections.abc import Iterator

from defusedxml.ElementTree import fromstring as _safe_fromstring

log = logging.getLogger(__name__)

XML_HDR = '<?xml version="1.0" encoding="UTF-8"?>'
MAX_RESPONSE = 4 * 1024 * 1024

_BARE_AMP = re.compile(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)")
_ENTITIES = (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&"))

ENUM_COMMANDS = {
    "modes": "GetModes",
    "filters": "GetFilters",
    "shapers": "GetShapers",
    "rates": "GetRates",
    "junk_filters": "GetJunkFilters",
}


class ControlError(Exception):
    pass


class CommandError(ControlError):
    """Daemon answered result="Error"."""


def _element_name(element: str) -> str:
    """The command name out of a request document, for error messages."""
    match = re.match(r"<([A-Za-z][\w-]*)", element)
    return match.group(1) if match is not None else "request"


@contextlib.contextmanager
def _as_control_error(what: str, timeout: float) -> Iterator[None]:
    """Raw socket failures as ``ControlError``, which is what callers handle.

    ``asyncio.wait_for`` raises a bare ``TimeoutError`` and a dead transport
    raises ``OSError``; neither is a ``ControlError``, so both escaped every
    caller — ``writer._apply_one`` could not record the setting as failed and the
    API answered a bodiless 500. Observed on 6.0.4 when the daemon accepted
    ``SetMode`` and then restarted without answering it.
    """
    try:
        yield
    except TimeoutError as exc:
        raise ControlError(f"{what}: no reply within {timeout:g}s (the daemon may have restarted)") from exc
    except OSError as exc:
        raise ControlError(f"{what}: connection failed: {exc}") from exc
    except ControlError as exc:
        # `_recv_document`'s own failures ("connection closed by daemon", a frame
        # that will not parse) name no command, and which command died is the whole
        # diagnostic — a daemon that drops the connection under `SetFilter` fails
        # some LATER command, and the message is the only place that pairing
        # survives. Every other failure here already carries it.
        raise ControlError(f"{what}: {exc}") from exc


def _lenient_fromstring(body: str) -> ET.Element:
    try:
        root: ET.Element = _safe_fromstring(body)
    except ET.ParseError:
        root = _safe_fromstring(_BARE_AMP.sub("&amp;", body))
    return root


def _unescape_attrs(root: ET.Element) -> ET.Element:
    for el in root.iter():
        for key, val in el.attrib.items():
            if "&" in val:
                for ent, ch in _ENTITIES:
                    val = val.replace(ent, ch)
                el.attrib[key] = val
    return root


def _document_complete(body: str, tag: str) -> bool:
    """True once the root element is closed — self-closing (`<Tag .../>`) or its
    end tag arrived (`</Tag>`). Distinguishes a still-arriving frame (keep
    reading) from a fully-received one that simply won't parse."""
    if re.match(rf"<{re.escape(tag)}\b[^>]*/>\s*$", body, re.S):
        return True
    return re.search(rf"</{re.escape(tag)}>\s*$", body) is not None


def _recover_root(body: str) -> ET.Element | None:
    """Salvage a COMPLETE frame whose children won't parse. The daemon emits
    track `<metadata>` with unescaped `<`/`"` in artist/song tags that the
    bare-`&` repair can't fix (hqpexporter-observed) — which would otherwise
    hang the receive loop until timeout on every poll while a track is loaded.
    The live fields we need (active_filter/active_shaper/active_rate) are ROOT
    attributes, so drop the children and parse the root open-tag alone. Returns
    None when the frame is merely still-arriving (caller keeps reading)."""
    m = re.match(r"<([A-Za-z][\w-]*)\b[^>]*", body, re.S)
    if m is None:
        return None
    if not _document_complete(body, m.group(1)):
        return None
    try:
        return _lenient_fromstring(m.group(0).rstrip("/") + "/>")
    except ET.ParseError as exc:
        raise ControlError("unparseable response document") from exc


class ControlClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 4321, timeout: float = 5.0):
        self._host = host
        self._port = port
        self._timeout = timeout
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        with _as_control_error("connect", self._timeout):
            reader, writer = await asyncio.wait_for(asyncio.open_connection(self._host, self._port), self._timeout)
        self._reader, self._writer = reader, writer
        sock = writer.get_extra_info("socket")
        if sock is not None:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)

    async def close(self) -> None:
        if self._writer is not None:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except OSError:
                pass
            self._reader = self._writer = None

    async def request(self, element: str) -> ET.Element:
        """Send one XML command document, return the parsed response root."""
        if self._writer is None:
            raise ControlError("not connected")
        async with self._lock:
            # covers the receive too: `_recv_document`'s own read deadline is the
            # one a stalled command trips, and it is this command's name that says
            # which command stalled
            with _as_control_error(_element_name(element), self._timeout):
                self._writer.write((XML_HDR + element).encode())
                await asyncio.wait_for(self._writer.drain(), self._timeout)
                return await self._recv_document()

    async def _recv_document(self) -> ET.Element:
        reader = self._reader
        if reader is None:
            raise ControlError("not connected")
        data = b""
        while True:
            chunk = await asyncio.wait_for(reader.read(65536), self._timeout)
            if not chunk:
                raise ControlError("connection closed by daemon")
            data += chunk
            text = data.decode("utf-8", errors="replace")
            body = text.split("?>", 1)[-1].strip() if "?>" in text else text.strip()
            if body:
                try:
                    return _unescape_attrs(_lenient_fromstring(body))
                except ET.ParseError:
                    # Either still arriving, or complete-but-malformed (child
                    # metadata with unescaped chars). Recover the root if the
                    # frame is complete; otherwise keep reading.
                    recovered = _recover_root(body)
                    if recovered is not None:
                        return _unescape_attrs(recovered)
            if len(data) > MAX_RESPONSE:
                raise ControlError("response exceeds size limit")

    # --- typed helpers -------------------------------------------------

    async def _attrs(self, element: str) -> dict[str, str]:
        """A query whose whole answer is the response root's attributes."""
        return dict((await self.request(element)).attrib)

    async def get_info(self) -> dict[str, str]:
        return await self._attrs("<GetInfo/>")

    async def get_license(self) -> dict[str, str]:
        return await self._attrs("<GetLicense/>")

    async def get_active_config(self) -> str:
        """The active configuration/preset name (empty string = the unnamed
        ``[default]`` base). Response carries it in the ``value`` attribute."""
        return (await self.request("<ConfigurationGet/>")).attrib.get("value", "")

    async def get_state(self) -> dict[str, str]:
        return await self._attrs("<State/>")

    async def get_volume_range(self) -> dict[str, str]:
        """`<VolumeRange/>` -> {min, max, enabled, adaptive} (dB doubles + flags).
        The authority for live-volume slider bounds and whether volume control is
        active at all (protocol.md §6, "Volume commands")."""
        return await self._attrs("<VolumeRange/>")

    async def get_status(self) -> tuple[dict[str, str], dict[str, str] | None]:
        root = await self.request('<Status subscribe="0"/>')
        meta = root.find("metadata")
        return dict(root.attrib), (dict(meta.attrib) if meta is not None else None)

    async def set_matrix_profile(self, name: str) -> None:
        """`<MatrixSetProfile value="..."/>` — live matrix-profile switch (empty
        = the unnamed [Default]). Probe-verified on 6.0.4: unauthenticated, zero
        reload, playback uninterrupted; memory-only, reverts on daemon restart
        (docs/matrix-spec.md probe findings)."""
        await self.set_command("MatrixSetProfile", value=name)

    async def get_matrix_profiles(self) -> list[str]:
        """`<MatrixListProfiles/>` -> saved matrix profile names (`MatrixProfile`
        children). Verified live on 6.0.4 (docs/matrix-spec.md probe findings):
        unauthenticated, live lane, no reload."""
        root = await self.request("<MatrixListProfiles/>")
        return [item.attrib.get("name", "") for item in root]

    async def get_enumeration(self, command: str) -> list[dict[str, str]]:
        root = await self.request(f"<{command}/>")
        return [dict(item.attrib) for item in root]

    async def get_all_enumerations(self) -> dict[str, list[dict[str, str]]]:
        return {key: await self.get_enumeration(cmd) for key, cmd in ENUM_COMMANDS.items()}

    async def set_command(self, element_name: str, **attrs: str) -> ET.Element:
        """Setter with result check. result="OK" or absent (SetAdaptiveVolume
        quirk, protocol.md §6) passes; result="Error" raises with the reason.
        Note result="OK" is not proof of application — callers verify by State
        readback (protocol.md §6 caveat)."""
        attr_str = "".join(f' {k}="{v}"' for k, v in attrs.items())
        root = await self.request(f"<{element_name}{attr_str}/>")
        result = root.get("result")
        if result is not None and result != "OK":
            raise CommandError(f"{element_name}: {result}: {(root.text or '').strip()}")
        return root

    # --- typed setters (index domain; protocol.md §6) ------------------
    #
    # Only the settings whose call is more than "one value attribute, one State
    # attribute" live here. The uniform ones (mode, shaper, rate, junk filter,
    # adaptive volume) are rows in ``writer.SETTINGS`` driving ``set_command``
    # directly — a wrapper per setting was a second place for the element name
    # to be spelled, and spelling it twice is how it drifts.

    async def set_filter(self, nx: str, x1: str | None = None) -> None:
        """`value` alone sets both 1x and Nx; `value1x` splits them (Nx=value,
        1x=value1x). Reference client omits value1x when the 1x arg is < 0."""
        if x1 is None:
            await self.set_command("SetFilter", value=nx)
        else:
            await self.set_command("SetFilter", value=nx, value1x=x1)

    async def set_volume(self, db: str) -> None:
        await self.set_command("Volume", value=db)

    async def verify_state(self, expected: dict[str, str]) -> None:
        """Re-read State and raise unless every expected attribute matches.
        result="OK" is not proof of application (protocol.md §6) — this is."""
        state = await self.get_state()
        mismatch = {k: (want, state.get(k)) for k, want in expected.items() if state.get(k) != want}
        if mismatch:
            raise CommandError(f"State readback mismatch (want, got): {mismatch}")
