"""The config the daemon is running, as the file, the staged edits and the engine say it."""

from __future__ import annotations


def realized_config(
    file_config: dict[str, str], staged: dict[str, str], engine_fields: dict[str, str]
) -> dict[str, str]:
    """Return the realized config."""
    del file_config, staged, engine_fields
    return {}
