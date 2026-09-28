"""Wire payloads for a staged matrix-profile save or delete.

Validates the JSON staged under ``matrix_profile_save`` and ``matrix_profile_delete`` into a named result the XML
editors can trust without re-checking. Each is one wire shape: an object naming the profile, with ``name`` a string
and ``presets`` a list when given. Row and profile-name validation live here too: a profile's rows are the same wire
shape the live pipeline table stages under ``matrix_pipelines``, and a profile name is validated identically whether
it names a save or a delete.
"""

from __future__ import annotations

import json
import re
from typing import Any, NamedTuple

from hqptuner.conf.xmledit import GroundingError

_GAIN_RE = re.compile(r"^-?\d+(\.\d+)?$")
_MAX_CHANNELS = 128
_NAME_MAX = 128
_FIRST_PRINTABLE = 0x20  # anything below is a control character the config XML cannot carry


class RowNotObjectError(GroundingError):
    """A staged pipeline row was not a JSON object."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix_pipelines: each row must be an object", code="row-not-object")


class RowChannelNotIntError(GroundingError):
    """A row's ``source``/``mixdown`` would not convert to an integer."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix_pipelines: source/mixdown must be integers", code="row-channel-not-int")


class RowChannelRangeError(GroundingError):
    """A row's ``source``/``mixdown`` fell outside the 0..127 channel range."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix_pipelines: source/mixdown out of range 0..127", code="row-channel-range")


class RowBadGainError(GroundingError):
    """A row's ``gain`` did not match the numeric gain pattern."""

    def __init__(self, *, gain: str) -> None:
        """Render the wording naming the rejected gain value."""
        super().__init__(f"matrix_pipelines: bad gain {gain!r}", code="row-bad-gain")


class RowBadGainUnitError(GroundingError):
    """A row's ``gainunit`` was neither ``dB`` nor ``Lin``."""

    def __init__(self, *, unit: str) -> None:
        """Render the wording naming the rejected gain unit."""
        super().__init__(f"matrix_pipelines: bad gainunit {unit!r}", code="row-bad-gainunit")


class RowControlCharsError(GroundingError):
    """A row's ``process`` string carried a control character."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix_pipelines: control characters in process string", code="row-control-chars")


class RowsBadListError(GroundingError):
    """The staged row set was not a list of 1..128 rows."""

    def __init__(self, *, field: str) -> None:
        """Render the wording naming the staged field that failed."""
        super().__init__(f"{field}: must be a list of 1..128 rows", code="rows-bad-list")


class NameNotStringError(GroundingError):
    """A staged profile name was not a string."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix profile: name must be a string", code="name-not-string")


class NameEmptyError(GroundingError):
    """A staged profile name was empty once stripped."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix profile: name must not be empty", code="name-empty")


class NameTooLongError(GroundingError):
    """A staged profile name exceeded ``_NAME_MAX`` characters."""

    def __init__(self, *, limit: int) -> None:
        """Render the wording naming the length limit that was exceeded."""
        super().__init__(f"matrix profile: name longer than {limit} characters", code="name-too-long")


class NameControlCharsError(GroundingError):
    """A staged profile name carried a control character."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix profile: control characters in name", code="name-control-chars")


class TargetsBadListError(GroundingError):
    """The staged fan-out ``presets`` value was not a list of preset names."""

    def __init__(self, *, field: str) -> None:
        """Render the wording naming the staged field that failed."""
        super().__init__(f"{field}: presets must be a list of preset names", code="targets-bad-list")


class SaveBadJsonError(GroundingError):
    """``matrix_profile_save`` did not parse as JSON at all."""

    def __init__(self, *, error: ValueError) -> None:
        """Render the wording naming the underlying JSON error."""
        super().__init__(f"matrix_profile_save: not valid JSON: {error}", code="save-bad-json")


class SaveBadShapeError(GroundingError):
    """``matrix_profile_save`` did not parse to an object with name and rows."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix_profile_save: must be an object with name and rows", code="save-bad-shape")


class DeleteBadJsonError(GroundingError):
    """``matrix_profile_delete`` did not parse as JSON at all."""

    def __init__(self, *, error: ValueError) -> None:
        """Render the wording naming the underlying JSON error."""
        super().__init__(f"matrix_profile_delete: not valid JSON: {error}", code="delete-bad-json")


class DeleteBadShapeError(GroundingError):
    """``matrix_profile_delete`` did not parse to an object with name and presets."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("matrix_profile_delete: must be an object with name and presets", code="delete-bad-shape")


def _validate_row(row: object) -> dict[str, str]:
    if not isinstance(row, dict):
        raise RowNotObjectError()
    try:
        source, mixdown = int(row["source"]), int(row["mixdown"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RowChannelNotIntError() from exc
    if not (0 <= source < _MAX_CHANNELS and 0 <= mixdown < _MAX_CHANNELS):
        raise RowChannelRangeError()
    gain = str(row.get("gain", "0"))
    if not _GAIN_RE.match(gain):
        raise RowBadGainError(gain=gain)
    unit = str(row.get("gainunit", "dB"))
    if unit not in ("dB", "Lin"):
        raise RowBadGainUnitError(unit=unit)
    process = str(row.get("process", ""))
    if any(ord(c) < _FIRST_PRINTABLE for c in process):
        raise RowControlCharsError()
    return {"source": str(source), "gain": gain, "gainunit": unit, "mixdown": str(mixdown), "process": process}


def rows_from_list(raw: object, field: str) -> list[dict[str, str]]:
    """Build a validated row set from an already-parsed list.

    Shared by the pipeline table and a saved profile — one row contract, so a
    profile can never hold a row the live table would have refused.
    """
    if not isinstance(raw, list) or not 1 <= len(raw) <= _MAX_CHANNELS:
        raise RowsBadListError(field=field)
    return [_validate_row(r) for r in raw]


def validate_name(name: object) -> str:
    """Return a profile name fit for an XML attribute.

    Escaping alone is not enough: the name is also this element's identity, so an
    empty or control-character name would produce a profile nothing can address
    again.
    """
    if not isinstance(name, str):
        raise NameNotStringError()
    cleaned: str = name.strip()
    if not cleaned:
        raise NameEmptyError()
    if len(cleaned) > _NAME_MAX:
        raise NameTooLongError(limit=_NAME_MAX)
    if any(ord(c) < _FIRST_PRINTABLE for c in cleaned):
        raise NameControlCharsError()
    return cleaned


def _validate_targets(raw: dict[str, Any], field: str) -> list[str]:
    """Return the payload's fan-out preset names.

    These are the stored presets the profile verb also applies to, beyond the
    config being edited. Optional; [] when absent.
    """
    presets = raw.get("presets", [])
    if not isinstance(presets, list) or any(not isinstance(p, str) for p in presets):
        raise TargetsBadListError(field=field)
    return presets


class SavePayload(NamedTuple):
    """A staged save value, fully validated: name, rows, and fan-out preset targets."""

    name: str
    rows: list[dict[str, str]]
    presets: list[str]


def parse_save(value: str) -> SavePayload:
    """(name, rows, presets) of a staged save value, validated once for the writer and the audit record alike."""
    try:
        raw = json.loads(value)
    except ValueError as exc:
        raise SaveBadJsonError(error=exc) from exc
    if not isinstance(raw, dict):
        raise SaveBadShapeError()
    return SavePayload(
        validate_name(raw.get("name")),
        rows_from_list(raw.get("rows"), "matrix_profile_save"),
        _validate_targets(raw, "matrix_profile_save"),
    )


def parse_delete(value: str) -> tuple[str, list[str]]:
    """(name, fan-out targets) of a staged delete: JSON ``{"name": ..., "presets": [...]}``, the one wire shape."""
    try:
        raw = json.loads(value)
    except ValueError as exc:
        raise DeleteBadJsonError(error=exc) from exc
    if not isinstance(raw, dict):
        raise DeleteBadShapeError()
    return validate_name(raw.get("name")), _validate_targets(raw, "matrix_profile_delete")
