"""The fake hqplayerd metering side channel (4322) — real frames over an in-process stream.

The frames are the caller's: this module packs no spectrum and derives nothing,
it streams the bytes it was handed (docs/testing.md rule 13). A client that
connects is sent ``frames`` copies of that frame back to back and then held
open, so a reader keeps its socket for the length of the case and the fake
never spins: once the reader's buffer is full the send blocks, and once the
frames are out the connection parks on a read that returns when the reader
hangs up.

`serve` is the fake as an asyncio stream callback, for the suite's in-process network (`fake_network`): it needs no
thread and no port, and answers on the loop of whoever dialed it.
"""

import asyncio


async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, frame: bytes, frames: int = 100) -> None:
    """Send `frames` copies of `frame`, then park until the reader hangs up. Derives nothing from the frame."""
    for _ in range(frames):
        writer.write(frame)
        await writer.drain()
    await reader.read(1)  # park: returns at end of file once the reader hangs up
