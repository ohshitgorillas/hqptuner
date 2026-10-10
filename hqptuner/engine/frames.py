"""Control API response framing: when an accumulated frame is complete, and how it is parsed leniently.

Bare ``&`` in attribute values is re-escaped before parsing (a daemon quirk), and entity-escaped-twice attribute
values are unescaped once more after parsing.
"""

import contextlib
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring as _safe_fromstring

from hqptuner.engine.controlerrors import UnparseableResponseError

_BARE_AMP = re.compile(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)")
#: An open tag's attribute run: quoted values may carry ``>``, which must not end the tag.
_OPEN_TAG_BODY = r"""(?:[^>"']|"[^"]*"|'[^']*')*"""
_ROOT_OPEN = re.compile(rf"<([A-Za-z][\w-]*)\b{_OPEN_TAG_BODY}")
_ENTITIES = (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&"))


def _lenient_fromstring(body: str, command: str) -> ET.Element:
    """Parse with the bare-``&`` repair applied; a no-op on well-formed input, so one parse serves both.

    A frame defusedxml refuses (an entity or DTD declaration) is unparseable, not still arriving, and is reported as
    the answer to ``command``.
    """
    try:
        root: ET.Element = _safe_fromstring(_BARE_AMP.sub("&amp;", body))
    except DefusedXmlException as exc:
        raise UnparseableResponseError(command=command, parser_error=str(exc)) from exc
    return root


def _complete_root_open(body: str) -> re.Match[str] | None:
    """Return the root element's open tag once the frame is complete, or None while it is still arriving."""
    root_open = _ROOT_OPEN.search(body)
    if root_open is None or not _document_complete(body[root_open.start() :], root_open.group(1)):
        return None
    return root_open


def parse_frame(body: str, command: str) -> ET.Element | None:
    """Parse one accumulated response frame, the answer to ``command``, or None while it is still arriving.

    Completeness is read from the frame's structure before any parse. A complete frame is parsed leniently (the
    bare-``&`` repair), falling back to a root-only recovery where its children still won't parse; attributes are
    unescaped either way. Raises ``ControlError`` naming ``command`` where the complete frame still cannot be
    recovered.
    """
    root_open = _complete_root_open(body)
    if root_open is None:
        return None
    root: ET.Element | None = None
    with contextlib.suppress(ET.ParseError):
        root = _lenient_fromstring(body, command)
    if root is None:
        root = _recover_root(root_open, command)
    return _unescape_attrs(root)


def _unescape_attrs(root: ET.Element) -> ET.Element:
    for el in root.iter():
        for key, val in el.attrib.items():
            if "&" in val:
                decoded = val
                for ent, ch in _ENTITIES:
                    decoded = decoded.replace(ent, ch)
                el.attrib[key] = decoded
    return root


def _document_complete(body: str, tag: str) -> bool:
    """Return True once the root element is closed.

    Closed means self-closing (`<Tag .../>`) or its end tag arrived (`</Tag>`). Distinguishes a still-arriving frame
    (keep reading) from a fully-received one that simply won't parse.
    """
    if re.match(rf"<{re.escape(tag)}\b{_OPEN_TAG_BODY}/>\s*$", body):
        return True
    return re.search(rf"</{re.escape(tag)}>\s*$", body) is not None


class FrameBuffer:
    """One response's bytes as they arrive, parsed once, when its root element has closed.

    The root's open tag is located once, re-tried only while it is still arriving; after that each chunk costs a look
    at the buffer's tail, not a re-read of everything received, so a large reply is not quadratic in its size. The
    complete frame goes through ``parse_frame`` unchanged.
    """

    def __init__(self, command: str) -> None:
        """Start empty, with no root located yet, for the answer to ``command``."""
        self._command = command
        self._data = bytearray()
        self._root: _Root | None = None

    def __len__(self) -> int:
        """Return how many bytes have arrived."""
        return len(self._data)

    def feed(self, chunk: bytes) -> ET.Element | None:
        """Append one chunk and return the parsed frame once it is complete, or None while it is still arriving.

        Raises ``ControlError`` naming the command where the complete frame cannot be recovered, as ``parse_frame``
        does.
        """
        self._data += chunk
        if self._root is None:
            self._root = _find_root(self._data)
        if self._root is None or not self._root.closed(self._data):
            return None
        text = self._data.decode("utf-8", errors="replace")
        return parse_frame(text.split("?>", 1)[-1].strip() if "?>" in text else text.strip(), self._command)


#: Characters a slice of UTF-8 can start with that a cut multi-byte sequence left undecodable.
_CUT_CHARS = 3


@dataclass
class _Root:
    """Where a frame's root open tag ends, in bytes, and what closes the root."""

    end_tag: str
    open_end: int
    self_closing: bool
    trailing_text: bool = False

    def closed(self, data: bytearray) -> bool:
        """Whether the root has closed: self-closing with only whitespace after it, or its end tag ends the data."""
        if self.self_closing and not self.trailing_text:
            rest = _decode(data[self.open_end :])
            if not rest.strip():
                return True
            # only the last few characters can still change as bytes arrive
            self.trailing_text = bool(rest[:-_CUT_CHARS].strip())
        return _ends_with(data, self.end_tag)


def _decode(data: bytes | bytearray) -> str:
    """Decode losslessly, so a character offset converts back to the byte offset it came from."""
    return bytes(data).decode("utf-8", errors="surrogateescape")


def _find_root(data: bytearray) -> _Root | None:
    """Locate the root's open tag past the XML declaration, or None while that tag has not fully arrived."""
    text = _decode(data)
    header = text.find("?>")
    match = _ROOT_OPEN.search(text, header + 2 if header >= 0 else 0)
    if match is None or not text.startswith(">", match.end()):
        return None
    open_end = len(text[: match.end() + 1].encode("utf-8", errors="surrogateescape"))
    return _Root(f"</{match.group(1)}>", open_end, match.group(0).endswith("/"))


def _ends_with(data: bytearray, end_tag: str) -> bool:
    """Whether ``data`` ends with ``end_tag`` and whitespace, read off a tail widened only past trailing whitespace."""
    width = len(end_tag.encode()) + _CUT_CHARS
    while True:
        tail = _decode(data[-width:]).rstrip()
        if len(tail) >= len(end_tag) + _CUT_CHARS or width >= len(data):
            return tail.endswith(end_tag)
        width *= 2


def _recover_root(root_open: re.Match[str], command: str) -> ET.Element:
    """Salvage a COMPLETE frame whose children won't parse, from its root open tag; ``command`` is what it answers.

    The daemon emits track `<metadata>` with unescaped `<`/`"` in artist/song tags that the bare-`&` repair can't fix.
    Without this salvage such a frame hangs the receive loop until timeout on every poll while a track is loaded. The
    live fields read here (active_filter/active_shaper/active_rate) are ROOT attributes, so the children are dropped and
    the root open tag is parsed alone.
    """
    try:
        return _lenient_fromstring(root_open.group(0).rstrip("/") + "/>", command)
    except ET.ParseError as exc:
        raise UnparseableResponseError(command=command, parser_error=str(exc)) from exc
