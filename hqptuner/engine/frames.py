"""Control API response framing: when an accumulated frame is complete, and how it is parsed leniently.

Bare ``&`` in attribute values is re-escaped before parsing (a daemon quirk), and entity-escaped-twice attribute
values are unescaped once more after parsing.
"""

import contextlib
import re
import xml.etree.ElementTree as ET

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring as _safe_fromstring

from hqptuner.engine.controlerrors import UnparseableResponseError

_BARE_AMP = re.compile(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)")
#: An open tag's attribute run: quoted values may carry ``>``, which must not end the tag.
_OPEN_TAG_BODY = r"""(?:[^>"']|"[^"]*"|'[^']*')*"""
_ROOT_OPEN = re.compile(rf"<([A-Za-z][\w-]*)\b{_OPEN_TAG_BODY}")
_ENTITIES = (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&"))


def _lenient_fromstring(body: str) -> ET.Element:
    """Parse with the bare-``&`` repair applied; a no-op on well-formed input, so one parse serves both.

    A frame defusedxml refuses (an entity or DTD declaration) is unparseable, not still arriving.
    """
    try:
        root: ET.Element = _safe_fromstring(_BARE_AMP.sub("&amp;", body))
    except DefusedXmlException as exc:
        raise UnparseableResponseError() from exc
    return root


def _complete_root_open(body: str) -> re.Match[str] | None:
    """Return the root element's open tag once the frame is complete, or None while it is still arriving."""
    root_open = _ROOT_OPEN.search(body)
    if root_open is None or not _document_complete(body[root_open.start() :], root_open.group(1)):
        return None
    return root_open


def parse_frame(body: str) -> ET.Element | None:
    """Parse one accumulated response frame, or None while it is still arriving.

    Completeness is read from the frame's structure before any parse. A complete frame is parsed leniently (the
    bare-``&`` repair), falling back to a root-only recovery where its children still won't parse; attributes are
    unescaped either way. Raises ``ControlError`` where the complete frame still cannot be recovered.
    """
    root_open = _complete_root_open(body)
    if root_open is None:
        return None
    root: ET.Element | None = None
    with contextlib.suppress(ET.ParseError):
        root = _lenient_fromstring(body)
    if root is None:
        root = _recover_root(root_open)
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


def _recover_root(root_open: re.Match[str]) -> ET.Element:
    """Salvage a COMPLETE frame whose children won't parse, from its root open tag.

    The daemon emits track `<metadata>` with unescaped `<`/`"` in artist/song tags that the bare-`&` repair can't fix.
    Without this salvage such a frame hangs the receive loop until timeout on every poll while a track is loaded. The
    live fields read here (active_filter/active_shaper/active_rate) are ROOT attributes, so the children are dropped and
    the root open tag is parsed alone.
    """
    try:
        return _lenient_fromstring(root_open.group(0).rstrip("/") + "/>")
    except ET.ParseError as exc:
        raise UnparseableResponseError() from exc
