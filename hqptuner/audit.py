"""Append-only event log — what HQPTuner wrote, and what it was handed.

Every durable write in this application funnels through a handful of seams: the
staged-edit buffer, the apply that drains it, the ``<matrix_profile>`` writer,
and the preset store. None of them recorded anything on the success path, so a
write that landed on the wrong name left no trace of the payload that produced
it — the buffer that held it is cleared by the same request that applied it.

This module is that trace. It is off unless ``HQPTUNER_DEBUG_LOG`` names a path;
disabled, every emitter is a no-op and no file is created. Records are JSON
Lines so an incident is answerable with ``jq`` and nothing else, and the
emitters are typed per event rather than free-form so the vocabulary stays
readable a year from now.

Values are captured whole up to ``MAX_VALUE_BYTES`` — a 16-row pipeline set is
about 15 KB, so the payload behind a bad profile save is recoverable FROM the
log rather than merely described by it. Anything larger is truncated and its
full digest recorded, which keeps one pathological upload from filling the disk.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

#: Per-value ceiling. Above this a value is truncated and digested instead.
MAX_VALUE_BYTES = 131_072

#: Roll the file once it passes this. Two files at this size is the worst case.
DEFAULT_MAX_BYTES = 16_000_000

#: Field names whose value never reaches the log, at any depth.
_REDACT_KEYS = frozenset({"password", "secret", "token"})
_REDACTED = "***"


def resolve_level(value: str) -> int:
    """The logging level ``value`` names, INFO when it names nothing.

    A misspelled level in the environment must not stop the daemon from
    starting: the operator wanted different logging, not no application."""
    level = logging.getLevelNamesMapping().get(value.strip().upper())
    return level if isinstance(level, int) else logging.INFO


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _scrub(value: Any, path: str, digests: dict[str, str]) -> Any:
    """``value`` fit to store: secrets replaced, oversized strings truncated.

    Walks to any depth, because the interesting payloads arrive nested — a
    staged profile save rides inside the ``http`` mapping, not beside it.
    ``digests`` collects the full digest of everything truncated, keyed by the
    dotted path to the field, so one record can carry several."""
    if isinstance(value, dict):
        return {k: _scrub_member(k, v, path, digests) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v, path, digests) for v in value]
    if isinstance(value, str):
        return _cap(value, path, digests)
    return value


def _cap(value: str, path: str, digests: dict[str, str]) -> str:
    """``value`` cut to the cap, measured in BYTES as the constant says — a
    100k-character CJK payload is 300 KB and has to count as oversized. Cutting
    the encoded form can land mid-codepoint, so the tail is dropped rather than
    kept as replacement characters."""
    encoded = value.encode("utf-8")
    if len(encoded) <= MAX_VALUE_BYTES:
        return value
    digests[path] = _digest(value)
    return encoded[:MAX_VALUE_BYTES].decode("utf-8", "ignore")


def _scrub_member(key: str, value: Any, path: str, digests: dict[str, str]) -> Any:
    if key.lower() in _REDACT_KEYS and isinstance(value, str):
        return _REDACTED
    return _scrub(value, f"{path}.{key}" if path else key, digests)


def _row_count(rows: str) -> int:
    """The number of pipeline rows ``rows`` carries — 0 when it is not a row
    set at all. A payload that does not parse is exactly what a reader needs to
    see recorded, so this reports rather than raises."""
    try:
        parsed = json.loads(rows)
    except ValueError:
        return 0
    return len(parsed) if isinstance(parsed, list) else 0


class AuditLog:
    """An append-only JSONL event log. ``path`` of None disables it entirely."""

    def __init__(self, path: Path | None, *, max_bytes: int = DEFAULT_MAX_BYTES) -> None:
        self._path = path
        self._max_bytes = max_bytes
        self._seq = self._resume_seq()

    @property
    def enabled(self) -> bool:
        return self._path is not None

    # --- reading -----------------------------------------------------------

    def records(self) -> list[dict[str, Any]]:
        """Every record in the CURRENT file, oldest first. A rotated-away file
        is deliberately not merged in: this reads what is live, and the rolled
        copy sits beside it under the same name plus ``.1``."""
        if self._path is None or not self._path.is_file():
            return []
        lines = self._path.read_text(encoding="utf-8").splitlines()
        out: list[dict[str, Any]] = [json.loads(line) for line in lines if line.strip()]
        return out

    def tail(self, n: int) -> list[dict[str, Any]]:
        """The ``n`` most recent records, newest last."""
        return self.records()[-n:] if n > 0 else []

    def _resume_seq(self) -> int:
        """The sequence number to continue from, so reopening a log does not
        restart the counter and make two records look like the same event."""
        records = self.records()
        return int(records[-1].get("seq", 0)) if records else 0

    # --- writing -----------------------------------------------------------

    def _rotate(self) -> None:
        if self._path is None or not self._path.is_file():
            return
        if self._path.stat().st_size >= self._max_bytes:
            self._path.replace(self._path.with_suffix(self._path.suffix + ".1"))

    def _write(self, event: str, fields: dict[str, Any]) -> None:
        if self._path is None:
            return
        digests: dict[str, str] = {}
        scrubbed = {k: _scrub_member(k, v, "", digests) for k, v in fields.items()}
        self._seq += 1
        record: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "seq": self._seq,
            "event": event,
            **scrubbed,
        }
        if digests:
            record["truncated"] = True
            record["full_digests"] = digests
        self._rotate()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")

    # --- the vocabulary ----------------------------------------------------

    def stage(self, http: dict[str, str], live: dict[str, dict[str, str]], dropped: dict[str, Any]) -> None:
        self._write("stage", {"http": http, "live": live, "dropped": dropped})

    def discard(self, http: dict[str, str], live: dict[str, dict[str, str]]) -> None:
        self._write("discard", {"http": http, "live": live})

    def apply(
        self,
        http: dict[str, str],
        live: dict[str, dict[str, str]],
        switch_to: str | None,
        save: str | None,
        *,
        ok: bool,
    ) -> None:
        """The staged set as it stood at ENTRY — the apply clears the buffer, so
        this is the only surviving copy of what was applied."""
        self._write("apply", {"http": http, "live": live, "switch_to": switch_to, "save": save, "ok": ok})

    def profile_write(self, name: str, rows: str, target: str, *, replaced: bool) -> None:
        self._write(
            "profile.write",
            {
                "name": name,
                "rows": rows,
                "row_count": _row_count(rows),
                "rows_digest": _digest(rows),
                "replaced": replaced,
                "target": target,
            },
        )

    def profile_delete(self, name: str, target: str, *, found: bool) -> None:
        self._write("profile.delete", {"name": name, "found": found, "target": target})

    def preset_write(self, name: str, trigger: str, size: int, digest: str, *, overwrote: bool) -> None:
        self._write(
            "preset.write",
            {"name": name, "trigger": trigger, "size": size, "digest": digest, "overwrote": overwrote},
        )

    def preset_delete(self, name: str, *, was_active: bool) -> None:
        self._write("preset.delete", {"name": name, "was_active": was_active})

    def preset_load(self, name: str, previous_active: str | None) -> None:
        self._write("preset.load", {"name": name, "previous_active": previous_active})

    def active_set(self, name: str | None, previous: str | None) -> None:
        self._write("active.set", {"name": name, "previous": previous})

    def autosave_set(self, *, enabled: bool, previous: bool) -> None:
        self._write("autosave.set", {"enabled": enabled, "previous": previous})

    def restore_upload(self, filename: str, size: int, digest: str) -> None:
        self._write("restore.upload", {"filename": filename, "size": size, "digest": digest})

    def live_write(self, field: str, value: str, readback: str | None, *, ok: bool) -> None:
        self._write("live.write", {"field": field, "value": value, "readback": readback, "ok": ok})
