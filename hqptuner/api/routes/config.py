"""The engine's configuration form."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

router = APIRouter(prefix="/api")


def config(manager: ConnectionManager) -> None:
    """Return the configuration form."""
    del manager
