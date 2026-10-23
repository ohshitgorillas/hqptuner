"""Health serializes the standing lifecycle and its recorded evidence."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from virtual_clock import VirtualClock

from hqptuner.api.routes import status
from hqptuner.config import Config
from hqptuner.core.lifecycle import Fact
from hqptuner.core.manager import ConnectionManager

HEALTH = "/api/health"
WINDOW = 15.0
HEALTH_KEYS = {"phase", "generation", "connected_at", "credentials_ok", "address_found"}


@dataclass
class HealthApp:
    client: httpx.AsyncClient
    manager: ConnectionManager
    clock: VirtualClock

    async def reading(self) -> dict[str, object]:
        response = await self.client.get(HEALTH)
        body: dict[str, object] = response.json()
        return body


@pytest.fixture
async def health_app(tmp_path: Path) -> AsyncIterator[HealthApp]:
    clock = VirtualClock()
    cfg = Config(
        alarm_threshold=WINDOW,
        backup_dir=tmp_path / "backups",
        preset_dir=tmp_path / "presets",
    )
    manager = ConnectionManager(cfg, clock=clock)
    app = FastAPI()
    app.state.manager = manager
    app.include_router(status.router)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield HealthApp(client, manager, clock)
    finally:
        await manager.aclose()


# Break: keep legacy metadata or omit an evidence verdict in the fixed health shape.
async def test_health_contains_exactly_the_fixed_reading_fields(health_app: HealthApp) -> None:
    assert set(await health_app.reading()) == HEALTH_KEYS


# Break: serialize the internal phase spelling or infer the phase from credential acceptance.
@pytest.mark.parametrize(
    ("facts", "phase"),
    [
        ([], "Down"),
        ([Fact.GETINFO_ANSWERED], "Reachable"),
        ([Fact.GETINFO_ANSWERED, Fact.FORM_ANSWERED], "Ready"),
        ([Fact.WINDOW_RAN], "Alarm"),
    ],
)
@pytest.mark.parametrize("accepted", [True, False])
async def test_health_serializes_the_lifecycle_phase_independently_of_credentials(
    health_app: HealthApp, facts: list[Fact], phase: str, *, accepted: bool
) -> None:
    await health_app.clock.advance(WINDOW)
    for fact in facts:
        health_app.manager.phase.report(fact, health_app.clock.monotonic())
    health_app.manager.readings.take_file(credentials_ok=accepted)
    assert (await health_app.reading())["phase"] == phase


# Break: omit address evidence, coerce unknown to false, or infer it from a standing connection.
@pytest.mark.parametrize("verdict", [True, False, None])
async def test_health_serializes_recorded_address_evidence_without_a_connection(
    health_app: HealthApp, *, verdict: bool | None
) -> None:
    health_app.manager.readings.address_found = True
    found = (await health_app.reading()).get("address_found", "absent")
    health_app.manager.readings.address_found = verdict
    recorded = (await health_app.reading()).get("address_found", "absent")
    assert (found, recorded) == (True, verdict)
