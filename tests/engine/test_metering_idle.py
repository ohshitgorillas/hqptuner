"""The metering reader's config switch: whether the 4322 side channel is
dialled at all.

The config cases build a `Config` under a patched environment."""

import pytest

from hqptuner.config import Config

# --- the config switch ------------------------------------------------------


def test_metering_is_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HQPTUNER_METERING_ENABLED", raising=False)
    assert Config().metering_enabled is True


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("0", False),
        ("false", False),
        ("FALSE", False),
        ("No", False),
        ("off", False),
        ("OFF", False),
        ("1", True),
        ("true", True),
        ("TRUE", True),
        ("yes", True),
        ("on", True),
    ],
)
def test_a_falsey_env_value_disables_metering_and_a_truthy_one_leaves_it_enabled(
    monkeypatch: pytest.MonkeyPatch, value: str, *, expected: bool
) -> None:
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", value)
    assert Config().metering_enabled is expected
