"""The register supplies the policy needed to read each setting independently."""

from enum import Enum

import pytest

from hqptuner.fields import query
from hqptuner.fields.model import BoundsSelector, FileSelector, ReadDescriptor


class Absent(Enum):
    """Missing policy cannot masquerade as an intentionally absent selector."""

    ROW = "row"


FILE_READS = (
    ("volume_fixed", FileSelector("file_config", "volume_fixed")),
    ("cuda", FileSelector("engine", "cuda")),
    ("multicore", FileSelector("engine", "multicore")),
    ("backend", FileSelector("file_config", "backend")),
    ("channels", FileSelector("file_config", "channels")),
    ("matrix_enabled", FileSelector("file_config", "matrix_enabled")),
    ("volume", None),
    ("junk_filter", None),
)
BOUND_READS = (
    ("channels", BoundsSelector("config_form", "channels")),
    ("gain_comp", BoundsSelector("config_form", "gain_comp")),
    ("volume", BoundsSelector("volume_range", "volume")),
    ("nblocks", BoundsSelector(None, "nblocks")),
    ("cuda_dev", BoundsSelector(None, "cuda_dev")),
    ("cuda_cdev", BoundsSelector(None, "cuda_cdev")),
    ("backend", None),
    ("cuda", None),
)
WRITE_LANES = (
    ("filter1x", "live"),
    ("oversampling", "live"),
    ("adaptive_volume", "live"),
    ("backend", "restore"),
    ("volume_fixed", "restore"),
    ("defaults_samplerate", "restore"),
    ("cuda", "restore"),
    ("matrix_enabled", "form"),
    ("matrix_profile", "matrix"),
    ("volume", "volume"),
)
SHOWN_STORES = (
    ("filter1x", "engine"),
    ("oversampling", "engine"),
    ("adaptive_volume", "engine"),
    ("matrix_profile", "engine"),
    ("volume", "engine"),
    ("backend", "file"),
    ("volume_fixed", "file"),
    ("defaults_samplerate", "file"),
    ("cuda", "file"),
    ("matrix_enabled", "file"),
)
OWN_RESTARTS = (
    ("filter1x", False),
    ("adaptive_volume", False),
    ("matrix_profile", False),
    ("volume", False),
    ("backend", True),
    ("volume_fixed", True),
    ("cuda", True),
    ("matrix_enabled", True),
)
READABLE_SETTINGS = ("filter1x", "volume_fixed", "cuda", "matrix_enabled", "volume")
UNREADABLE_SETTINGS = ("matrix_profile_save", "matrix_profile_delete", "samplerate", "bitrate", "auto_family")


def descriptor(name: str) -> ReadDescriptor | None:
    """Return the setting's typed read policy when it has one."""
    row = query.field(name)
    return None if row is None else row.read


@pytest.mark.parametrize(("name", "selector"), FILE_READS)
def test_file_selector_names_the_authoritative_source(name: str, selector: FileSelector | None) -> None:
    # Break: route archive-only volume_fixed through the lossy config checkbox.
    reading = descriptor(name)
    assert reading is not None
    assert reading.file == selector


@pytest.mark.parametrize(("name", "selector"), BOUND_READS)
def test_bounds_selector_names_the_daemon_evidence(name: str, selector: BoundsSelector | None) -> None:
    # Break: discard a numeric bounds requirement when its daemon source is unavailable.
    reading = descriptor(name)
    assert reading is not None
    assert reading.bounds == selector


@pytest.mark.parametrize(("name", "lane"), WRITE_LANES)
def test_each_setting_names_its_own_write_lane(name: str, lane: str) -> None:
    # Break: classify rate limits as live rate pins.
    reading = descriptor(name)
    assert reading is not None
    assert reading.lane == lane


@pytest.mark.parametrize(("name", "store"), SHOWN_STORES)
def test_each_setting_shows_its_read_authority(name: str, store: str) -> None:
    # Break: show the File value for live chain filters.
    reading = descriptor(name)
    assert reading is not None
    assert reading.show == store


@pytest.mark.parametrize(("name", "restarts"), OWN_RESTARTS)
def test_restart_classification_belongs_to_the_setting(name: str, *, restarts: bool) -> None:
    # Break: mark live settings as restarting because they can accompany a restore.
    reading = descriptor(name)
    assert reading is not None
    assert reading.restarts is restarts


@pytest.mark.parametrize("name", READABLE_SETTINGS)
def test_readable_settings_keep_the_registered_descriptor(name: str) -> None:
    # Break: omit a readable setting or replace its policy while selecting rows.
    selected = {row.name: row.read for row in query.readable()}
    row = query.field(name)
    assert row is not None
    assert selected.get(name, Absent.ROW) == row.read


@pytest.mark.parametrize(
    ("name", "readable"),
    [(name, True) for name in READABLE_SETTINGS] + [(name, False) for name in UNREADABLE_SETTINGS],
)
def test_readable_settings_distinguish_values_from_actions_and_forced_slots(name: str, *, readable: bool) -> None:
    # Break: include action-only or never-read rows in the readable selection.
    selected = {row.name for row in query.readable()}
    assert (name in selected) is readable
