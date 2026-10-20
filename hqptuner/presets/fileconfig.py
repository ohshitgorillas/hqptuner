"""Readers over the backup archive: the fields that live only in ``hqplayerd.xml``.

``read_engine`` always fetches the archive through ``require_http().backup()``; ``load_file_config`` fetches it
unless the caller hands one over; ``record_file_config`` and ``record_engine`` only record. Each records what it
parsed through ``readings.take_file``. None runs per status beat, since the archive is large: the loader reads it
once per connection, and the rest run on demand or after an apply's verify step.
"""

from typing import TYPE_CHECKING

from hqptuner.conf import engineconf, presetconf

if TYPE_CHECKING:
    from hqptuner.presets import PresetManager


async def read_engine(mgr: "PresetManager") -> dict[str, str]:
    """Return current hardware-accel engine attributes, parsed from a fresh backup's base config.

    That backup is the only lane that carries them — they are not on the form.
    """
    backup = await mgr.require_http().backup()
    engine = engineconf.read_engine_attrs(engineconf.base_config_xml(backup, mgr.readings.active_config))
    record_engine(mgr, engine)
    return engine


def record_engine(mgr: "PresetManager", engine: dict[str, str]) -> None:
    """Record ``engine`` as the File's engine-tag attributes: the one writer of ``readings.engine``."""
    mgr.readings.take_file(engine=engine)


async def load_file_config(mgr: "PresetManager", *, backup: bytes | None = None) -> dict[str, str]:
    """Read running config from the backup archive's working ``hqplayerd.xml``, in form-field terms.

    Serves the fields the ``/config`` form renders lossily (``volume_fixed``: 0/1/2 in XML, a
    bare checkbox on the form). ``backup`` is an archive the caller already fetched; without one
    the archive is fetched here.
    """
    if backup is None:
        backup = await mgr.require_http().backup()
    return record_file_config(mgr, backup)


def record_file_config(mgr: "PresetManager", backup: bytes) -> dict[str, str]:
    """Read ``backup``'s working ``hqplayerd.xml`` into form-field terms, record it as the file truth, and return it.

    Raises ``engineconf.UnreadableArchiveError`` for bytes that are not a readable archive, recording nothing.
    """
    file_config = presetconf.read_config(engineconf.base_config_xml(backup, mgr.readings.active_config))
    mgr.readings.take_file(file_config=file_config)
    return file_config
