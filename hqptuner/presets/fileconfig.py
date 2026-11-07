"""Readers over the backup archive: the fields that live only in ``hqplayerd.xml``.

``read_engine`` always fetches the archive through ``require_http().backup()``; ``load_file_config`` fetches it
unless the caller hands one over; ``record_file_config`` and ``record_engine`` only record. Each records what it
parsed through ``readings.take_file``. None runs per status beat, since the archive is large: the loader reads it
once per connection, and the rest run on demand or after an apply's verify step.
"""

from typing import TYPE_CHECKING

from hqptuner.conf import engineconf, presetconf

if TYPE_CHECKING:
    from hqptuner.lanes import FileAcquisition
    from hqptuner.presets import PresetManager


async def read_engine(mgr: "PresetManager") -> dict[str, str]:
    """Return current hardware-accel engine attributes, parsed from a fresh backup's base config.

    That backup is the only lane that carries them — they are not on the form.
    """
    generation = mgr.phase.standing.generation
    acquisition = mgr.readings.acquire_file("engine")
    source = mgr.require_http()
    backup = await source.backup()
    engine = engineconf.read_engine_attrs(engineconf.base_config_xml(backup, mgr.readings.active_config))
    if source is mgr.http_client:
        record_engine(mgr, engine, generation=generation, acquisition=acquisition)
    return engine


def record_engine(
    mgr: "PresetManager",
    engine: dict[str, str],
    *,
    generation: int | None = None,
    acquisition: "FileAcquisition | None" = None,
) -> None:
    """Record ``engine`` as the File's engine-tag attributes: the one writer of ``readings.engine``."""
    if acquisition is None or mgr.readings.file_current(acquisition):
        mgr.readings.take_file(generation=generation, engine=engine)


async def load_file_config(
    mgr: "PresetManager",
    *,
    backup: bytes | None = None,
    generation: int | None = None,
    acquisition: "FileAcquisition | None" = None,
) -> dict[str, str]:
    """Read running config from the backup archive's working ``hqplayerd.xml``, in form-field terms.

    Serves the fields the ``/config`` form renders lossily (``volume_fixed``: 0/1/2 in XML, a
    bare checkbox on the form). ``backup`` is an archive the caller already fetched; without one
    the archive is fetched here.
    """
    if backup is None:
        generation = mgr.phase.standing.generation
        acquisition = mgr.readings.acquire_file("file_config")
        source = mgr.require_http()
        backup = await source.backup()
    return record_file_config(mgr, backup, generation=generation, acquisition=acquisition)


def record_file_config(
    mgr: "PresetManager",
    backup: bytes,
    *,
    generation: int | None = None,
    acquisition: "FileAcquisition | None" = None,
) -> dict[str, str]:
    """Read ``backup``'s working ``hqplayerd.xml`` into form-field terms, record it as the file truth, and return it.

    Raises ``engineconf.UnreadableArchiveError`` for bytes that are not a readable archive, recording nothing.
    """
    file_config = presetconf.read_config(engineconf.base_config_xml(backup, mgr.readings.active_config))
    if acquisition is None or mgr.readings.file_current(acquisition):
        mgr.readings.take_file(generation=generation, file_config=file_config)
    return file_config
