"""A daemon that answers the discovery datagram (docs/protocol.md §2), served on the in-process network.

The reply is looked up in a table the test writes, keyed by the exact request bytes: nothing here derives an answer,
so a client that sends a different document is answered with silence rather than with a reply the fake invented.
The table is registered at a caller-named loopback address, so a search can be pointed at an address that is not the
one the container-host alias names.
"""

from collections.abc import Iterator, Mapping
from contextlib import contextmanager

import fake_network


@contextmanager
def in_process(replies: Mapping[bytes, bytes], host: str = "127.0.0.2") -> Iterator[int]:
    """Answer `replies` at `host` on a port of the in-process network (`fake_network`), yielding the port.

    No socket exists: the network's datagram socket looks the table up at the address a search sends to, so the same
    table answers on any loop. A request the table does not hold is answered with silence."""
    with fake_network.responding(replies, host) as port:
        yield port
