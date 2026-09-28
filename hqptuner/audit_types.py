"""Types for the audit log's per-record fields.

``audit.py`` and ``audit_narrow.py`` — the isinstance narrowing that builds ``AuditFields`` from a parsed JSONL row —
both import this vocabulary, so ``audit_narrow.py`` never imports ``audit.py`` and the import stays one-way.
"""

from typing import TypedDict

#: A value as it arrives off the wire or out of a parsed JSON line: any shape ``json.loads`` can produce.
type Json = bool | int | float | str | list["Json"] | dict[str, "Json"] | None


class DroppedFields(TypedDict, total=False):
    """The ``dropped`` field of a ``stage`` record: the pending-buffer entries that request also reported clean."""

    live: dict[str, list[str]]
    http: list[str]


class AuditFields(TypedDict, total=False):
    """Every field key any vocabulary emitter in ``audit.py`` can write, as ``AuditRecord.fields`` reads it back.

    One shared, all-optional bag rather than one TypedDict per event: a record's own ``event`` name already says
    which subset was written, and this is what a JSONL reader can narrow into without knowing the event in advance.
    """

    http: dict[str, str]
    live: dict[str, dict[str, str]]
    dropped: DroppedFields
    switch_to: str | None
    save: str | None
    ok: bool
    name: str | None
    rows: str
    row_count: int
    rows_digest: str
    replaced: bool
    target: str
    found: bool
    trigger: str
    size: int
    digest: str
    overwrote: bool
    was_active: bool
    previous_active: str | None
    previous: str | bool | None
    enabled: bool
    source: str
    host: str
    username: str
    remember: bool
    want: str
    engaged: str | None
    filename: str
    field: str
    value: str
    readback: str | None
    fields: dict[str, str | None]
    last_write: str | None
    truncated: bool
    full_digests: dict[str, str]
