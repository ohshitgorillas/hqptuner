"""The config route serves current field readings without HTTP management."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from virtual_clock import VirtualClock

from hqptuner.api.routes import config
from hqptuner.conf.formparse import parse_config_form
from hqptuner.config import Config
from hqptuner.core.lifecycle import Fact
from hqptuner.core.manager import ConnectionManager
from hqptuner.core.pending import PendingStore

CONFIG = "/api/config"
FILE_GENERATION = 17
TITLE = "fixture-title"
METADATA = ("profiles", "active_preset", "device_caps", "info", "release", "license", "app_version")
SETTING_KEYS = {"engine", "file", "staged", "lane", "show", "restarts", "diverges", "bounds"}


@dataclass
class ConfigApp:
    client: httpx.AsyncClient
    manager: ConnectionManager
    pending: PendingStore

    async def reading(self) -> dict[str, Any]:
        response = await self.client.get(CONFIG)
        body: dict[str, Any] = response.json()
        return body

    async def field(self, name: str) -> dict[str, Any]:
        field: dict[str, Any] = (await self.reading()).get("fields", {}).get(name, {})
        return field


@pytest.fixture
async def config_app(tmp_path: Path) -> AsyncIterator[ConfigApp]:
    cfg = Config(backup_dir=tmp_path / "backups", preset_dir=tmp_path / "presets")
    manager = ConnectionManager(cfg, clock=VirtualClock())
    pending = PendingStore()
    app = FastAPI()
    app.state.manager = manager
    app.state.pending = pending
    app.include_router(config.router)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield ConfigApp(client, manager, pending)
    finally:
        await manager.aclose()


# Break: require HTTP management or keep the legacy Snapshot envelope.
async def test_config_returns_the_direct_reading_with_unread_stores(config_app: ConfigApp) -> None:
    assert set(await config_app.reading()) == {"generation", "fields"}


# Break: use a File acquisition stamp as the response generation.
@pytest.mark.parametrize("reconnected", [False, True])
async def test_config_generation_tracks_the_lifecycle(config_app: ConfigApp, *, reconnected: bool) -> None:
    if reconnected:
        config_app.manager.phase.report(Fact.GETINFO_ANSWERED, config_app.manager.clock.monotonic())
        config_app.manager.phase.report(Fact.SOCKET_LOST, config_app.manager.clock.monotonic())
        config_app.manager.phase.report(Fact.GETINFO_ANSWERED, config_app.manager.clock.monotonic())
    config_app.manager.readings.take_file(generation=FILE_GENERATION, file_config={"title": TITLE})
    assert (await config_app.reading()).get("generation") == config_app.manager.phase.standing.generation


# Break: serialize the former form field instead of the shared setting reading.
async def test_config_setting_uses_the_fixed_field_shape(config_app: ConfigApp) -> None:
    assert set(await config_app.field("title")) == SETTING_KEYS


# Break: omit the source value or overwrite its stamp with the lifecycle generation.
@pytest.mark.parametrize("title", [TITLE, "fixture-next-title"])
async def test_config_serves_the_acquired_file_reading(config_app: ConfigApp, title: str) -> None:
    config_app.manager.readings.take_file(generation=FILE_GENERATION, file_config={"title": title})
    assert (await config_app.field("title")).get("file") == {"value": title, "generation": FILE_GENERATION}


# Break: compose with an empty pending buffer rather than the request's buffer.
@pytest.mark.parametrize("title", ["fixture-staged-a", "fixture-staged-b"])
async def test_config_serves_the_request_pending_buffer(config_app: ConfigApp, title: str) -> None:
    config_app.manager.readings.take_file(generation=FILE_GENERATION, file_config={"title": TITLE})
    config_app.pending.stage(live={}, http={"title": title})
    assert (await config_app.field("title")).get("staged") == title


# Break: keep a numeric control absent even after its daemon limits arrive.
async def test_config_numeric_control_waits_for_its_daemon_limits(config_app: ConfigApp) -> None:
    before = await config_app.reading()
    config_app.manager.readings.take_file(
        generation=FILE_GENERATION,
        config_form=parse_config_form(
            '<form method="post"><input type="number" name="gain_comp" min="-9" max="3" step="0.25"></form>'
        ),
    )
    after = await config_app.reading()
    assert ("gain_comp" in before.get("fields", {}), "gain_comp" in after.get("fields", {})) == (False, True)


# Break: remove displaced metadata or serve it outside the shared fields object.
@pytest.mark.parametrize("name", METADATA)
async def test_config_metadata_is_served_as_readonly_fields(config_app: ConfigApp, name: str) -> None:
    assert (await config_app.field(name)).get("readonly") is True


# Break: replace the recorded daemon info with a constant or omit its payload.
@pytest.mark.parametrize("product", ["fixture-daemon-a", "fixture-daemon-b"])
async def test_config_metadata_preserves_daemon_info(config_app: ConfigApp, product: str) -> None:
    config_app.manager.readings.info = {"product": product}
    assert (await config_app.field("info")).get("value") == {"product": product}
