"""The ways the app opens a connection to the daemon (docs/testing.md rule 16), handed to the manager and the app.

Production takes the defaults below, each asyncio's or httpx's own call. The suite hands in a network
whose fakes answer in process, so no offline test opens a connection to another process.
"""

import asyncio
from dataclasses import dataclass

from hqptuner.engine.control import Opener


@dataclass(frozen=True)
class Network:
    """The connections one manager and its lanes open."""

    open_stream: Opener = asyncio.open_connection
