"""Profile descriptions — the prose the user wrote about a saved matrix profile, kept for the install.

A description is keyed by profile NAME, never by any id the daemon hands out: names are the stable join key
(architecture §2), and ``<matrix_profile>`` carries exactly one attribute, ``name`` (readme §1.12), so there is
nowhere in the config XML for this text to live. It is HQPTuner's own record, the way favorites are.

Stored as one JSON file beside the live presets and the favorites, and for the same reason: a few hundred short
paragraphs, so a file per profile would be all overhead. Layout follows ``favorites``' conventions — a schema
stamp that refuses a store newer than this HQPTuner understands, an unstamped file adopted on its next write, lazy
creation so an install that never describes anything reads as empty.

What the text is FOR sets the limits: the conditions a set of filters was measured under — room, mic, target,
date — which is exactly what a profile name cannot hold. So newlines and tabs survive verbatim (people paste
measurement headers), and every other control character is refused, because the store round-trips through JSON in a
zip member and a stray byte there is a corrupt archive rather than a funny-looking paragraph.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from hqptuner import __version__

if TYPE_CHECKING:
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. A file stamped higher is
# refused rather than guessed at. An unstamped file predates the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1

# Ceilings on what a client may store. A description is a paragraph about a measurement, not a document; the profile
# ceiling matches the daemon's 128-channel matrix with room to spare, and the name ceiling is the one
# ``matrixconf._validate_name`` already enforces on the profile element itself.
_MAX_TEXT = 2000
_MAX_PROFILES = 256
_MAX_NAME_LEN = 128

# Control characters the text may carry. Everything below 0x20 is refused except these two, which are what a pasted
# measurement header is made of.
_KEPT_CONTROLS = ("\n", "\t")
_FIRST_PRINTABLE = 0x20


class DescriptionError(ValueError):
    """A description operation that cannot proceed — a name or a text that is not storable."""


class DescriptionSchemaError(DescriptionError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``DescriptionError`` so a caller catching the general error catches this too, and separate from it
    so a route can answer "this store is unreadable" rather than "your text is invalid", which would blame the client
    for the server's file.
    """


def _validate_name(name: Any) -> str:
    """Return a profile name fit to key an entry, raising ``DescriptionError`` when it is not one."""
    if not isinstance(name, str) or not name.strip():
        raise DescriptionError("profile name must not be empty")
    cleaned = name.strip()
    if len(cleaned) > _MAX_NAME_LEN:
        raise DescriptionError(f"profile name is longer than {_MAX_NAME_LEN} characters: {cleaned[:40]!r}")
    if any(ord(c) < _FIRST_PRINTABLE for c in cleaned):
        raise DescriptionError(f"control characters in profile name: {cleaned[:40]!r}")
    return cleaned


def _validate_text(text: Any) -> str:
    """Return the description text as it will be stored, raising ``DescriptionError`` when it cannot be.

    Empty is legal here and means "no description" — the caller turns that into a removal.
    """
    if not isinstance(text, str):
        raise DescriptionError("description must be text")
    if len(text) > _MAX_TEXT:
        raise DescriptionError(f"description is longer than {_MAX_TEXT} characters: {len(text)}")
    if any(ord(c) < _FIRST_PRINTABLE and c not in _KEPT_CONTROLS for c in text):
        raise DescriptionError("control characters in description")
    return text


def _entry(text: str) -> dict[str, str]:
    """One stored entry: the text, and the instant it was written."""
    return {"text": text, "updated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


def _clean(stored: Any) -> dict[str, dict[str, str]]:
    """Return the storable entries of a ``profiles`` mapping, dropping anything that is not one.

    A file another version wrote, or one a client corrupted, loses the entries that make no sense rather than the
    whole store.
    """
    if not isinstance(stored, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for name, entry in stored.items():
        if not isinstance(name, str) or not name or not isinstance(entry, dict):
            continue
        text, updated = entry.get("text"), entry.get("updated")
        if isinstance(text, str) and text and isinstance(updated, str):
            out[name] = {"text": text, "updated": updated}
    return out


class DescriptionStore:
    """Profile descriptions in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never describes a profile
    reads as empty.
    """

    def __init__(self, path: Path) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write."""
        self._path = path

    def _read_file(self) -> dict[str, Any]:
        """Return the file as a dict, empty when absent or unreadable.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working.
        """
        if not self._path.is_file():
            return {}
        try:
            data = json.loads(self._path.read_text())
        except (ValueError, OSError):
            return {}
        if not isinstance(data, dict):
            return {}
        schema = data.get("schema")
        if isinstance(schema, int) and schema > _SCHEMA:
            raise DescriptionSchemaError(
                f"descriptions store is schema {schema}, this HQPTuner {__version__} understands "
                f"{_SCHEMA} — upgrade HQPTuner to read these descriptions"
            )
        return data

    def _save(self, profiles: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
        """Write the whole map out and return it."""
        if len(profiles) > _MAX_PROFILES:
            raise DescriptionError(f"too many described profiles: {len(profiles)} (limit {_MAX_PROFILES})")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"schema": _SCHEMA, "profiles": profiles}, indent=2, sort_keys=True))
        return profiles

    def read(self) -> dict[str, dict[str, str]]:
        """Every stored description, keyed by profile name. Empty when nothing is stored."""
        return _clean(self._read_file().get("profiles"))

    def write(self, name: str, text: str) -> dict[str, dict[str, str]]:
        """Store ``text`` against profile ``name`` and return the whole map.

        Empty or whitespace-only text REMOVES the entry: a description the user cleared is not a description that is
        blank, and an empty entry would put a name in every listing that has nothing to say. Guards the schema first
        — a store we cannot read is not one we should be writing into.
        """
        key = _validate_name(name)
        body = _validate_text(text)
        profiles = _clean(self._read_file().get("profiles"))
        if not body.strip():
            profiles.pop(key, None)
        else:
            profiles[key] = _entry(body)
        return self._save(profiles)

    def merge(self, payload: bytes) -> dict[str, dict[str, str]]:
        """Fold a stored payload (``export_bytes``, or a carried backup member) into this store and return the map.

        A name in both takes the PAYLOAD's entry: the payload is the thing being restored, and a restore that lost to
        whatever happened to be on disk would not be one. A payload that is not our record is refused whole rather
        than merged in part.
        """
        try:
            data = json.loads(payload)
        except (ValueError, UnicodeDecodeError) as exc:
            raise DescriptionError(f"carried descriptions are not readable: {exc}") from exc
        if not isinstance(data, dict) or not isinstance(data.get("profiles", {}), dict):
            raise DescriptionError("carried descriptions are not a descriptions store")
        incoming = _clean(data.get("profiles"))
        if not incoming:
            return self.read()
        return self._save({**self.read(), **incoming})

    def export_bytes(self) -> bytes:
        """Return the store's on-disk bytes, for carrying in a backup archive. Empty store, empty bytes."""
        profiles = self.read()
        if not profiles:
            return b""
        return json.dumps({"schema": _SCHEMA, "profiles": profiles}, indent=2, sort_keys=True).encode()
