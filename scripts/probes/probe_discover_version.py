"""Probe: what does the UDP discovery reply's ``version`` attribute carry?

protocol.md §2 documents the request and the reply shape but the ``version``
value was unverified — GetInfo's ``version`` is the bare major ("6") while
``engine`` is the engine build ("6.0.4"), and neither is the installed
release number. Answer (6.0.2 install): ``version="Signalyst HQPlayer
Embedded 6"`` — major only, so discovery cannot source the release either.
Read-only: one multicast datagram, print every reply.
"""

from __future__ import annotations

import socket

REQUEST = b'<?xml version="1.0" encoding="UTF-8"?><discover>hqplayer</discover>'


def main() -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3.0)
    sock.sendto(REQUEST, ("239.192.0.199", 4321))
    try:
        while True:
            data, addr = sock.recvfrom(65535)
            print(addr[0], data.decode(errors="replace"))
    except TimeoutError:
        pass


if __name__ == "__main__":
    main()
