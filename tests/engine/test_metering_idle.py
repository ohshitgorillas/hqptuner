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
    ("falsey", "truthy"),
    [
        ("0", "1"),
        ("false", "true"),
        ("FALSE", "TRUE"),
        ("No", "yes"),
        ("off", "on"),
        ("OFF", "on"),
    ],
)
def test_a_falsey_env_value_disables_metering_and_a_truthy_one_leaves_it_enabled(
    monkeypatch: pytest.MonkeyPatch, falsey: str, truthy: str
) -> None:
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", falsey)
    disabled = Config().metering_enabled
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", truthy)
    enabled = Config().metering_enabled
    assert (disabled, enabled) == (False, True)
