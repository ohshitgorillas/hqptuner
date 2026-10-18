"""Health, state, status and the merged enumerations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import APIRouter

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager
    from hqptuner.metadata import StaticMetadata

router = APIRouter(prefix="/api")


@dataclass(frozen=True)
class HealthReport:
    """The connection's health as the app reports it."""

    phase: str
    generation: int
    connected_at: float | None
    info: dict[str, str] | None
    license: dict[str, str] | None
    release: str
    app_version: str
    credentials_ok: bool | None
    dropped_settings: list[str]


def health(manager: ConnectionManager) -> HealthReport:
    """Return the health report."""
    del manager
    return HealthReport(
        phase="",
        generation=0,
        connected_at=None,
        info=None,
        license=None,
        release="",
        app_version="",
        credentials_ok=None,
        dropped_settings=[],
    )


def state(manager: ConnectionManager) -> None:
    """Return the engine state."""
    del manager


def status(manager: ConnectionManager) -> None:
    """Return the engine status."""
    del manager


def merged_enumerations(manager: ConnectionManager, static: StaticMetadata) -> None:
    """Return the running engine's enumerations joined with the static data."""
    del manager, static
