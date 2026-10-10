"""One reader for every stamped JSON store file: read the document, or refuse to read a broken one.

Every stamped store shares this shape: a JSON object, missing entirely
reads as an empty document because nothing has been saved yet, and a document stamped with a ``schema`` newer than
this HQPTuner understands is a store the caller should not guess at. What differs, per store, is what "newer" raises
and what the file is CALLED in the message a user reads — the approved copy, "{store} file unreadable: {path}. Fix
or remove the file, then reload." — so this module owns the shared shape and each store still builds its own
too-new exception.

A file that will not parse, or that parses to something other than a JSON object, is not an empty store: it is a
broken one, and a read says so rather than quietly starting over. A file the filesystem refuses to open is neither:
that ``OSError`` reaches the caller, whose ``unwritable.reading`` block names the store. A document that
parses fine but is missing a KEY the store expects (no ``presets``, no ``facets``) is not corrupt — that is a store
nothing has been saved into yet — and stays each store's own reading, past this function.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from hqptuner.errors import HQPTunerError

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


class StoreCorruptError(HQPTunerError):
    """A store file that exists but cannot be read as the JSON object it claims to be.

    Raised for bytes that will not parse, and for a value that parses to something other than an object — never for
    a value that parses fine but fails a store's own validation, which is that store's own error to raise.
    """

    code = "store_corrupt"

    def __init__(self, store: str, path: Path) -> None:
        """Carry the approved copy naming ``store`` (what to call the file) and ``path`` (where it is)."""
        super().__init__(f"{store} file unreadable: {path}. Fix or remove the file, then reload.")


def read_stamped(
    path: Path,
    *,
    store: str,
    schema: int | None = None,
    too_new: Callable[[int], HQPTunerError] | None = None,
) -> object:
    """Return the JSON object at ``path``, empty when the file does not exist.

    Raises ``StoreCorruptError`` when the file exists but cannot be read as a JSON object — unparseable bytes, or a
    value that parsed to a list, a string, a number or ``null``. An ``OSError`` from the filesystem refusing the read
    is not corruption and propagates, for the caller's ``unwritable.reading`` to name the store it belongs to. When
    ``schema`` and ``too_new`` are both given and the document's own ``schema`` member is an int greater than
    ``schema``, raises the exception ``too_new`` builds from that stamp — the store's own too-new error, since only
    the store knows how to word it. A document with no usable ``schema`` member, or one this HQPTuner understands, is
    returned as read, an ``object`` because each store's own reading is what judges its members — this function only
    rules on whether the FILE is readable.
    """
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
    except ValueError as exc:
        raise StoreCorruptError(store, path) from exc
    if not isinstance(data, dict):
        raise StoreCorruptError(store, path)
    if schema is not None and too_new is not None:
        stamp = data.get("schema")
        if isinstance(stamp, int) and stamp > schema:
            raise too_new(stamp)
    return data
