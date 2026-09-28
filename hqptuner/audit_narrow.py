"""Narrowing one parsed JSONL audit row's fields into ``AuditFields``, isinstance-only, never with cast.

``narrow_fields`` takes whatever a line's envelope keys (``seq``/``ts``/``event``) were popped off of. A key this module
does not recognize, or one holding the wrong shape, is dropped rather than trusted blind: every value here came from
this application's own emitters, so a mismatch means a hand-edited or foreign line, not a bug worth crashing the reader
over.
"""

from typing import TypeGuard

from hqptuner.audit_types import AuditFields, DroppedFields, Json


def _is_str(value: object) -> TypeGuard[str]:
    return isinstance(value, str)


def _is_opt_str(value: object) -> TypeGuard[str | None]:
    return value is None or isinstance(value, str)


def _is_bool(value: object) -> TypeGuard[bool]:
    return isinstance(value, bool)


def _is_int(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_opt_str_or_bool(value: object) -> TypeGuard[str | bool | None]:
    return value is None or isinstance(value, str | bool)


def _is_str_map(value: object) -> TypeGuard[dict[str, str]]:
    return isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items())


def _is_opt_str_map(value: object) -> TypeGuard[dict[str, str | None]]:
    return isinstance(value, dict) and all(
        isinstance(k, str) and (v is None or isinstance(v, str)) for k, v in value.items()
    )


def _is_nested_str_map(value: object) -> TypeGuard[dict[str, dict[str, str]]]:
    return isinstance(value, dict) and all(isinstance(k, str) and _is_str_map(v) for k, v in value.items())


def _is_str_list(value: object) -> TypeGuard[list[str]]:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _is_str_list_map(value: object) -> TypeGuard[dict[str, list[str]]]:
    return isinstance(value, dict) and all(isinstance(k, str) and _is_str_list(v) for k, v in value.items())


def _dropped(raw: object) -> DroppedFields:
    entry: DroppedFields = {}
    if not isinstance(raw, dict):
        return entry
    live = raw.get("live")
    if _is_str_list_map(live):
        entry["live"] = live
    http = raw.get("http")
    if _is_str_list(http):
        entry["http"] = http
    return entry


def _stage_apply_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``stage``/``discard``/``apply`` share: ``http``/``live``/``dropped``/``switch_to``/``save``/``ok``."""
    out: AuditFields = {}
    http = data.get("http")
    if _is_str_map(http):
        out["http"] = http
    live = data.get("live")
    if _is_nested_str_map(live):
        out["live"] = live
    if "dropped" in data:
        out["dropped"] = _dropped(data["dropped"])
    switch_to = data.get("switch_to")
    if _is_opt_str(switch_to):
        out["switch_to"] = switch_to
    save = data.get("save")
    if _is_opt_str(save):
        out["save"] = save
    ok = data.get("ok")
    if _is_bool(ok):
        out["ok"] = ok
    return out


def _profile_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``profile.write``/``profile.delete`` fields: ``name``, ``rows``, ``row_count``, ``replaced``, ..."""
    out: AuditFields = {}
    name = data.get("name")
    if _is_opt_str(name):
        out["name"] = name
    rows = data.get("rows")
    if _is_str(rows):
        out["rows"] = rows
    row_count = data.get("row_count")
    if _is_int(row_count):
        out["row_count"] = row_count
    rows_digest = data.get("rows_digest")
    if _is_str(rows_digest):
        out["rows_digest"] = rows_digest
    replaced = data.get("replaced")
    if _is_bool(replaced):
        out["replaced"] = replaced
    target = data.get("target")
    if _is_str(target):
        out["target"] = target
    found = data.get("found")
    if _is_bool(found):
        out["found"] = found
    return out


def _preset_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``preset.write``/``preset.delete``/``preset.load``/``active.set`` fields."""
    out: AuditFields = {}
    trigger = data.get("trigger")
    if _is_str(trigger):
        out["trigger"] = trigger
    size = data.get("size")
    if _is_int(size):
        out["size"] = size
    digest = data.get("digest")
    if _is_str(digest):
        out["digest"] = digest
    overwrote = data.get("overwrote")
    if _is_bool(overwrote):
        out["overwrote"] = overwrote
    was_active = data.get("was_active")
    if _is_bool(was_active):
        out["was_active"] = was_active
    previous_active = data.get("previous_active")
    if _is_opt_str(previous_active):
        out["previous_active"] = previous_active
    previous = data.get("previous")
    if _is_opt_str_or_bool(previous):
        out["previous"] = previous
    return out


def _switch_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``autosave.set``/``autopilot.set``/``connection.set``/``autopilot.act``/``restore.upload`` fields."""
    out: AuditFields = {}
    enabled = data.get("enabled")
    if _is_bool(enabled):
        out["enabled"] = enabled
    source = data.get("source")
    if _is_str(source):
        out["source"] = source
    host = data.get("host")
    if _is_str(host):
        out["host"] = host
    username = data.get("username")
    if _is_str(username):
        out["username"] = username
    remember = data.get("remember")
    if _is_bool(remember):
        out["remember"] = remember
    want = data.get("want")
    if _is_str(want):
        out["want"] = want
    engaged = data.get("engaged")
    if _is_opt_str(engaged):
        out["engaged"] = engaged
    filename = data.get("filename")
    if _is_str(filename):
        out["filename"] = filename
    return out


def _live_fields(data: dict[str, Json]) -> AuditFields:
    """Narrow the ``live.write``/``volume.write``/``volume.observe`` fields, plus the shared truncation markers."""
    out: AuditFields = {}
    field = data.get("field")
    if _is_str(field):
        out["field"] = field
    value = data.get("value")
    if _is_str(value):
        out["value"] = value
    readback = data.get("readback")
    if _is_opt_str(readback):
        out["readback"] = readback
    fields = data.get("fields")
    if _is_opt_str_map(fields):
        out["fields"] = fields
    last_write = data.get("last_write")
    if _is_opt_str(last_write):
        out["last_write"] = last_write
    truncated = data.get("truncated")
    if _is_bool(truncated):
        out["truncated"] = truncated
    full_digests = data.get("full_digests")
    if _is_str_map(full_digests):
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
