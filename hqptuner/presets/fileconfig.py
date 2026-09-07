"""Readers over the backup archive: the fields that live only in ``hqplayerd.xml``.

Both fetch through ``presetops.backup_or_cached`` and cache what they parse in
``readings``. Neither runs per poll, since the archive is large; each is fetched
on connect, on demand, or after an apply's verify step.
"""

from typing import TYPE_CHECKING

from hqptuner.conf import engineconf, presetconf

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager


async def read_engine(mgr: "ConnectionManager") -> dict[str, str]:
    """Return current hardware-accel engine attributes, parsed from a fresh backup's base config.

    That backup is the only lane that carries them — they are not on the form.
    """
    readings = mgr.readings
    readings.engine = engineconf.read_engine_attrs(
        engineconf.base_config_xml(await mgr.presetops.backup_or_cached(), readings.active_config)
    )
    return readings.engine


async def load_file_config(mgr: "ConnectionManager") -> dict[str, str]:
    """Read running config from the backup archive's working ``hqplayerd.xml``, in form-field terms.

    Serves the fields the ``/config`` form renders lossily (``volume_fixed``: 0/1/2 in XML, a
    bare checkbox on the form).
    """
    backup = await mgr.presetops.backup_or_cached()
    mgr.readings.file_config = presetconf.read_config(engineconf.base_config_xml(backup, mgr.readings.active_config))
    return mgr.readings.file_config
