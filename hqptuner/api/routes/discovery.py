"""Discovery REST surface — which hqplayerds are on this network, and what each one is.

One route, read-only, on demand: nothing polls it and no background task runs, so an install that never asks
pays nothing. It answers whole records rather than addresses, because the question behind it is which daemon
the user has, and that is the product and platform fields, not the address.
"""

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Request

from hqptuner.engine.discovery import Search, discover

router = APIRouter(prefix="/api")


@router.get("/discover")
async def discover_daemons(request: Request) -> list[dict[str, Any]]:
    """Answer with every hqplayerd that answers discovery on this network, each with what it says it is."""
    # Target, wait and control port all come off the app's own Config, so an
    # install pointed at one host searches that host rather than the group.
    cfg = request.app.state.config
    search = Search(
        target=cfg.discovery_target,
        alias=cfg.container_host_alias,
        control_port=cfg.hqp_control_port,
        request_timeout=cfg.request_timeout,
    )
    found = await discover(search, cfg.discovery_timeout)
    return [asdict(daemon) for daemon in found]
