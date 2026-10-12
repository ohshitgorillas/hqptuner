"""Narrowing one parsed JSONL audit row's fields into ``AuditFields``, isinstance-only, never with cast.

``narrow_fields`` takes whatever a line's envelope keys (``seq``/``ts``/``event``) were popped off of. A key this module
does not recognize, or one holding the wrong shape, is dropped rather than trusted blind: every value here came from
this application's own emitters, so a mismatch means a hand-edited or foreign line, not a bug worth crashing the reader
over.
"""

from collections.abc import Callable
from typing import TypeGuard

from hqptuner.audit_types import AuditFields, DroppedFields, Json
from hqptuner.shape.guards import is_bool, is_int, is_opt_str, is_str, is_str_list, is_str_map


def _is_opt_str_or_bool(value: object) -> TypeGuard[str | bool | None]:
    return value is None or isinstance(value, str | bool)


def _is_map_of[T](value: object, guard: Callable[[object], TypeGuard[T]]) -> TypeGuard[dict[str, T]]:
    """Return whether ``value`` is a dict of string keys whose every value passes ``guard``."""
    return isinstance(value, dict) and all(isinstance(k, str) and guard(v) for k, v in value.items())


def _is_opt_str_map(value: object) -> TypeGuard[dict[str, str | None]]:
    return _is_map_of(value, is_opt_str)


def _is_nested_str_map(value: object) -> TypeGuard[dict[str, dict[str, str]]]:
    return _is_map_of(value, is_str_map)


def _is_str_list_map(value: object) -> TypeGuard[dict[str, list[str]]]:
    return _is_map_of(value, is_str_list)


def _dropped(raw: object) -> DroppedFields:
    entry: DroppedFields = {}
    if not isinstance(raw, dict):
        return entry
    live = raw.get("live")
    if _is_str_list_map(live):
        entry["live"] = live
    http = raw.get("http")
    if is_str_list(http):
        entry["http"] = http
    return entry


def _stage_apply_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``stage``/``discard``/``apply`` share: ``http``/``live``/``dropped``/``switch_to``/``save``/``ok``."""
    out: AuditFields = {}
    http = data.get("http")
    if is_str_map(http):
        out["http"] = http
    live = data.get("live")
    if _is_nested_str_map(live):
        out["live"] = live
    if "dropped" in data:
        out["dropped"] = _dropped(data["dropped"])
    switch_to = data.get("switch_to")
    if is_opt_str(switch_to):
        out["switch_to"] = switch_to
    save = data.get("save")
    if is_opt_str(save):
        out["save"] = save
    ok = data.get("ok")
    if is_bool(ok):
        out["ok"] = ok
    return out


def _profile_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``profile.write``/``profile.delete`` fields: ``name``, ``rows``, ``row_count``, ``replaced``, ..."""
    out: AuditFields = {}
    name = data.get("name")
    if is_opt_str(name):
        out["name"] = name
    rows = data.get("rows")
    if is_str(rows):
        out["rows"] = rows
    row_count = data.get("row_count")
    if is_int(row_count):
        out["row_count"] = row_count
    rows_digest = data.get("rows_digest")
    if is_str(rows_digest):
        out["rows_digest"] = rows_digest
    replaced = data.get("replaced")
    if is_bool(replaced):
        out["replaced"] = replaced
    target = data.get("target")
    if is_str(target):
        out["target"] = target
    found = data.get("found")
    if is_bool(found):
        out["found"] = found
    return out


def _preset_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``preset.write``/``preset.delete``/``preset.load``/``active.set`` fields."""
    out: AuditFields = {}
    trigger = data.get("trigger")
    if is_str(trigger):
        out["trigger"] = trigger
    size = data.get("size")
    if is_int(size):
        out["size"] = size
    digest = data.get("digest")
    if is_str(digest):
        out["digest"] = digest
    overwrote = data.get("overwrote")
    if is_bool(overwrote):
        out["overwrote"] = overwrote
    was_active = data.get("was_active")
    if is_bool(was_active):
        out["was_active"] = was_active
    previous_active = data.get("previous_active")
    if is_opt_str(previous_active):
        out["previous_active"] = previous_active
    previous = data.get("previous")
    if _is_opt_str_or_bool(previous):
        out["previous"] = previous
    return out


def _switch_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``autosave.set``/``autopilot.set``/``connection.set``/``autopilot.act``/``restore.upload`` fields."""
    out: AuditFields = {}
    enabled = data.get("enabled")
    if is_bool(enabled):
        out["enabled"] = enabled
    source = data.get("source")
    if is_str(source):
        out["source"] = source
    host = data.get("host")
    if is_str(host):
        out["host"] = host
    username = data.get("username")
    if is_str(username):
        out["username"] = username
    remember = data.get("remember")
    if is_bool(remember):
        out["remember"] = remember
    want = data.get("want")
    if is_str(want):
        out["want"] = want
    engaged = data.get("engaged")
    if is_opt_str(engaged):
        out["engaged"] = engaged
    filename = data.get("filename")
    if is_str(filename):
        out["filename"] = filename
    return out


def _live_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``live.write``/``volume.write``/``volume.observe`` fields, plus the shared truncation markers."""
    out: AuditFields = {}
    field = data.get("field")
    if is_str(field):
        out["field"] = field
    value = data.get("value")
    if is_str(value):
        out["value"] = value
    readback = data.get("readback")
    if is_opt_str(readback):
        out["readback"] = readback
    fields = data.get("fields")
    if _is_opt_str_map(fields):
        out["fields"] = fields
    last_write = data.get("last_write")
    if is_opt_str(last_write):
        out["last_write"] = last_write
    truncated = data.get("truncated")
    if is_bool(truncated):
        out["truncated"] = truncated
    full_digests = data.get("full_digests")
    if is_str_map(full_digests):
        out["full_digests"] = full_digests
    return out


def narrow_fields(data: dict[str, Json]) -> AuditFields:
    """Return ``data`` filtered to the keys ``AuditFields`` names, each kept only when its value fits that key.

    Each helper narrows the key group one vocabulary emitter writes. A record's own ``event`` says which subset is
    actually populated; this only narrows what is there.
    """
    out: AuditFields = {}
    out.update(_stage_apply_fields(data))
    out.update(_profile_fields(data))
    out.update(_preset_fields(data))
    out.update(_switch_fields(data))
    out.update(_live_fields(data))
    return out
