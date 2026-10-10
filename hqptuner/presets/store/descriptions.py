"""Profile descriptions — the prose the user wrote about a saved matrix profile, kept for the install.

A description is keyed by profile NAME, never by any id the daemon hands out: ``<matrix_profile>``
carries exactly one attribute, ``name`` (readme §1.12), so there is nowhere in the config XML for this text to live.
It is HQPTuner's own record, the way favorites are.

Stored as one JSON file beside the live snapshots and the favorites, and for the same reason: a few hundred short
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
from functools import partial
from typing import TYPE_CHECKING, TypedDict

from hqptuner import __version__
from hqptuner.config import DESCRIPTION_STORE
from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.jsonfile import read_stamped
from hqptuner.unwritable import reading, saving

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

# The store's on-disk layout version — what the file MEANS, not which HQPTuner wrote it. A file stamped higher is
# refused rather than guessed at. An unstamped file predates the stamp and is adopted as schema 1 on its next write.
_SCHEMA = 1

# Ceilings on what a client may store. A description is a paragraph about a measurement, not a document; the profile
# ceiling matches the daemon's 128-channel matrix with room to spare, and the name ceiling is the one
# the profile element's own name validation enforces.
_MAX_TEXT = 2000
_MAX_PROFILES = 256
_MAX_NAME_LEN = 128

# Control characters the text may carry. Everything below 0x20 is refused except these two, which are what a pasted
# measurement header is made of.
_KEPT_CONTROLS = ("\n", "\t")
_FIRST_PRINTABLE = 0x20

# The store's default clock, a module-level singleton a constructor default reads.
_DEFAULT_NOW = partial(datetime.now, UTC)


class DescriptionEntry(TypedDict):
    """One profile's stored description: the text, and the instant it was written."""

    text: str
    updated: str


class DescriptionsFile(TypedDict, total=False):
    """The on-disk envelope: a schema stamp beside the profile-name-to-entry map."""

    schema: int
    profiles: dict[str, DescriptionEntry]


class DescriptionError(HQPTunerError, ValueError):
    """A description operation that cannot proceed — a name or a text that is not storable."""

    code = "invalid_input"


class DescriptionSchemaError(DescriptionError):
    """The stored file is stamped newer than this HQPTuner understands.

    A subclass of ``DescriptionError`` so a caller catching the general error catches this too, and separate from it
    so a route can answer "this store is unreadable" rather than "your text is invalid", which would blame the client
    for the server's file.
    """

    code = "store_too_new"

    def __init__(self, *, stamp: int, understood: int, what: str) -> None:
        """Render the too-new wording naming the store's stamp, what this build understands, and what it cannot read."""
        super().__init__(
            f"descriptions store is schema {stamp}, this HQPTuner {__version__} understands "
            f"{understood} — upgrade HQPTuner to read {what}"
        )


class NameEmptyError(DescriptionError):
    """A staged profile name was empty, or not a string, once stripped."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("profile name must not be empty")


class NameTooLongError(DescriptionError):
    """A staged profile name exceeded ``_MAX_NAME_LEN`` characters."""

    def __init__(self, *, limit: int, name: str) -> None:
        """Render the wording naming the length limit and the (already-truncated) offending name."""
        super().__init__(f"profile name is longer than {limit} characters: {name!r}")


class NameControlCharsError(DescriptionError):
    """A staged profile name carried a control character."""

    def __init__(self, *, name: str) -> None:
        """Render the wording naming the (already-truncated) offending name."""
        super().__init__(f"control characters in profile name: {name!r}")


class TextNotStringError(DescriptionError):
    """A staged description was not text at all."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("description must be text")


class TextTooLongError(DescriptionError):
    """A staged description exceeded ``_MAX_TEXT`` characters."""

    def __init__(self, *, limit: int, length: int) -> None:
        """Render the wording naming the length limit and the offending length."""
        super().__init__(f"description is longer than {limit} characters: {length}")


class TextControlCharsError(DescriptionError):
    """A staged description carried a control character outside the kept set."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("control characters in description")


class TooManyProfilesError(DescriptionError):
    """A save would carry more described profiles than ``_MAX_PROFILES``."""

    def __init__(self, *, count: int, limit: int) -> None:
        """Render the wording naming the count that was about to be saved and the limit it exceeds."""
        super().__init__(f"too many described profiles: {count} (limit {limit})")


class CarriedNotReadableError(DescriptionError):
    """A carried payload (export or backup member) would not parse as JSON at all."""

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the underlying parse error."""
        super().__init__(f"carried descriptions are not readable: {error}")


class CarriedNotAStoreError(DescriptionError):
    """A carried payload parsed but is not shaped like a descriptions store."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("carried descriptions are not a descriptions store")


def _validate_name(name: object) -> str:
    """Return a profile name fit to key an entry, raising ``DescriptionError`` when it is not one."""
    if not isinstance(name, str) or not name.strip():
        raise NameEmptyError()
    cleaned = name.strip()
    if len(cleaned) > _MAX_NAME_LEN:
        raise NameTooLongError(limit=_MAX_NAME_LEN, name=cleaned[:40])
    if any(ord(c) < _FIRST_PRINTABLE for c in cleaned):
        raise NameControlCharsError(name=cleaned[:40])
    return cleaned


def _validate_text(text: object) -> str:
    """Return the description text as it will be stored, raising ``DescriptionError`` when it cannot be.

    Empty is legal here and means "no description" — the caller turns that into a removal.
    """
    if not isinstance(text, str):
        raise TextNotStringError()
    if len(text) > _MAX_TEXT:
        raise TextTooLongError(limit=_MAX_TEXT, length=len(text))
    if any(ord(c) < _FIRST_PRINTABLE and c not in _KEPT_CONTROLS for c in text):
        raise TextControlCharsError()
    return text


def _entry(text: str, now: datetime) -> DescriptionEntry:
    """One stored entry: the text, and the instant it was written, in UTC whatever zone the clock reads in."""
    return {"text": text, "updated": now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}


def _clean_entry(name: object, entry: object) -> DescriptionEntry | None:
    """Return one storable entry, or ``None`` when the name or the entry does not shape up.

    A name that is not a non-empty string, an entry that is not a dict, or a ``text``/``updated`` pair that is not
    both a non-empty string and a string respectively, is not storable — the caller drops it rather than the whole
    store.
    """
    if not isinstance(name, str) or not name or not isinstance(entry, dict):
        return None
    text, updated = entry.get("text"), entry.get("updated")
    if isinstance(text, str) and text and isinstance(updated, str):
        return {"text": text, "updated": updated}
    return None


def _clean(stored: object) -> DescriptionsFile:
    """Return a read document's envelope, keeping the stamp when it is an int and only the storable profile entries.

    A file another version wrote, or one a client corrupted, loses the entries that make no sense rather than the
    whole store.
    """
    out: DescriptionsFile = {}
    if not isinstance(stored, dict):
        return out
    schema = stored.get("schema")
    if isinstance(schema, int):
        out["schema"] = schema
    profiles = stored.get("profiles")
    if not isinstance(profiles, dict):
        return out
    entries: dict[str, DescriptionEntry] = {}
    for name, entry in profiles.items():
        cleaned = _clean_entry(name, entry)
        if cleaned is not None:
            entries[name] = cleaned
    out["profiles"] = entries
    return out


class DescriptionStore:
    """Profile descriptions in one JSON file.

    The file (and its directory) is created lazily on the first write, so an install that never describes a profile
    reads as empty.
    """

    def __init__(self, path: Path, *, now: Callable[[], datetime] = _DEFAULT_NOW) -> None:
        """Bind the store to the JSON file at ``path``, which is not touched until the first write.

        ``now`` supplies the instant stamped on a write; a test passes a fixed clock.
        """
        self._path = path
        self._now = now

    def _read_file(self) -> DescriptionsFile:
        """Return the file as a dict, empty when absent.

        Every path goes through here, so a too-new store refuses uniformly instead of half-working, and a file that
        cannot be read as a JSON object raises ``StoreCorruptError`` rather than losing the descriptions silently.
        """

        def _too_new(stamp: int) -> DescriptionSchemaError:
            return DescriptionSchemaError(stamp=stamp, understood=_SCHEMA, what="these descriptions")

        with reading(DESCRIPTION_STORE.what, self._path):
            data = read_stamped(self._path, store="descriptions", schema=_SCHEMA, too_new=_too_new)
        return _clean(data)

    def _save(self, profiles: dict[str, DescriptionEntry]) -> dict[str, DescriptionEntry]:
        """Write the whole map out and return it."""
        if len(profiles) > _MAX_PROFILES:
            raise TooManyProfilesError(count=len(profiles), limit=_MAX_PROFILES)
        with saving(DESCRIPTION_STORE.what, self._path):
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps({"schema": _SCHEMA, "profiles": profiles}, indent=2, sort_keys=True))
        return profiles

    def read(self) -> dict[str, DescriptionEntry]:
        """Every stored description, keyed by profile name. Empty when nothing is stored."""
        return self._read_file().get("profiles", {})

    def write(self, name: str, text: str) -> dict[str, DescriptionEntry]:
        """Store ``text`` against profile ``name`` and return the whole map.

        Empty or whitespace-only text REMOVES the entry: a description the user cleared is not a description that is
        blank, and an empty entry would put a name in every listing that has nothing to say. Guards the schema first
        — a store we cannot read is not one we should be writing into.
        """
        key = _validate_name(name)
        body = _validate_text(text)
        profiles = self._read_file().get("profiles", {})
        if not body.strip():
            profiles.pop(key, None)
        else:
            profiles[key] = _entry(body, self._now())
        return self._save(profiles)

    def merge(self, payload: bytes) -> dict[str, DescriptionEntry]:
        """Fold a stored payload (``export_bytes``, or a carried backup member) into this store and return the map.

        A name in both takes the PAYLOAD's entry: the payload is the thing being restored, and a restore that lost to
        whatever happened to be on disk would not be one. A payload that is not our record is refused whole rather
        than merged in part.
        """
        try:
            data = json.loads(payload)
        except (ValueError, UnicodeDecodeError) as exc:
            raise CarriedNotReadableError(error=exc) from exc
        if not isinstance(data, dict) or not isinstance(data.get("profiles", {}), dict):
            raise CarriedNotAStoreError()
        incoming = _clean(data).get("profiles", {})
        if not incoming:
            return self.read()
        return self._save({**self.read(), **incoming})

    def export_bytes(self) -> bytes:
        """Return the store's on-disk bytes, for carrying in a backup archive. Empty store, empty bytes."""
        profiles = self.read()
        if not profiles:
            return b""
        return json.dumps({"schema": _SCHEMA, "profiles": profiles}, indent=2, sort_keys=True).encode()
