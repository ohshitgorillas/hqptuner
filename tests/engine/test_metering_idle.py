"""The metering reader's config switch: whether the 4322 side channel is
dialled at all.

The config cases build a `Config` under a patched environment."""

import pytest

from hqptuner.config import Config

# --- the config switch ------------------------------------------------------


def test_metering_is_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HQPTUNER_METERING_ENABLED", raising=False)
    assert Config().metering_enabled is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "No", "off", "OFF"])
def test_a_falsey_env_value_disables_metering(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", value)
    assert Config().metering_enabled is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_a_truthy_env_value_leaves_metering_enabled(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.delenv("HQPTUNER_METERING_ENABLED", raising=False)
    monkeypatch.setenv("HQPTUNER_METERING_ENABLED", value)
    assert Config().metering_enabled is True
