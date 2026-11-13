"""Capture the dev container's meter feed, as a page sees it, into a replayable fixture.

Read-only toward hqplayerd, but not silent. It opens one ``GET /api/meter/feed``
on the dev container (the request a page makes) and one ``GET /api/status``. It
sends no command to hqplayerd, writes nothing but its output file and touches
no staging buffer. Its feed subscription can wake the container's metering
reader (``hqptuner/engine/meterfeed.py``), which then holds a read-only
metering connection to the production hqplayerd for as long as the subscription
lasts. The status read is served through the container's own Status lane, also
read-only.

The fixture records every server-sent event in arrival order: the event type,
its data text exactly as the wire carried it, and the event's arrival in ms on
a monotonic clock counted from the capture's start. It also records the
engine's ``output_delay`` verbatim from the status block (microseconds as text,
or null where absent) and the spectrum offset the owner's page shows, in
seconds, which only the owner can read. Together they give the page's
``effectiveDelay`` (``hqptuner/static/store/meter/delay.js``).

The listener starts the music; this probe never touches transport.

Usage:
    capture_meter_feed.py <spectrum-offset-s> [output-path] [capture-seconds]
"""

import http.client
import itertools
import json
import socket
import sys
import time
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8090
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "tests" / "support" / "fixtures" / "meter_feed_capture.json"
DEFAULT_SECONDS = 6.0
RECV_TIMEOUT_S = 0.25
EVENT_END = b"\n\n"
HEADER_END = b"\r\n\r\n"
GAP_OVER_MS = 100
OUT_ARG = 1
SECONDS_ARG = 2


def engine_output_delay() -> str | None:
    """Return the status block's ``output_delay`` text as the wire gives it, or None where it carries none."""
    conn = http.client.HTTPConnection(HOST, PORT, timeout=5)
    try:
        conn.request("GET", "/api/status")
        body = json.loads(conn.getresponse().read())
    finally:
        conn.close()
    value = body["data"]["status"].get("output_delay")
    return None if value is None else str(value)


def parse_event(text: str) -> tuple[str, str]:
    """Return the event type and data text of one server-sent event block."""
    name = "message"
    data: list[str] = []
    for line in text.split("\n"):
        field, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if field == "event":
            name = value
        elif field == "data":
            data.append(value)
    return name, "\n".join(data)


def capture(seconds: float) -> list[dict[str, object]]:
    """Return every event the feed sends in a bounded window, each with its arrival in ms from the start."""
    events: list[dict[str, object]] = []
    buf = b""
    started = time.monotonic()
    with socket.create_connection((HOST, PORT), timeout=5) as sock:
        request = f"GET /api/meter/feed HTTP/1.0\r\nHost: {HOST}:{PORT}\r\nAccept: text/event-stream\r\n\r\n"
        sock.sendall(request.encode("ascii"))
        sock.settimeout(RECV_TIMEOUT_S)
        in_headers = True
        while time.monotonic() - started < seconds:
            try:
                chunk = sock.recv(65536)
            except TimeoutError:
                continue
            if not chunk:
                break
            arrived = (time.monotonic() - started) * 1000.0
            buf += chunk
            if in_headers:
                head, sep, buf = buf.partition(HEADER_END)
                if not sep:
                    buf = head
                    continue
                if b"chunked" in head.lower() or b" 200 " not in head.split(b"\r\n")[0]:
                    msg = f"unexpected response head: {head[:200]!r}"
                    raise SystemExit(msg)
                in_headers = False
            while EVENT_END in buf:
                block, buf = buf.split(EVENT_END, 1)
                if block.startswith(b":") or not block:
                    continue
                name, data = parse_event(block.decode("utf-8"))
                events.append({"t_ms": round(arrived, 3), "event": name, "data": data})
    return events


def main(argv: list[str]) -> None:
    """Capture the feed, write the fixture, and print the counts and the longest arrival gap."""
    if not argv:
        raise SystemExit(__doc__)
    offset = float(argv[0])
    out = Path(argv[OUT_ARG]) if len(argv) > OUT_ARG else DEFAULT_OUT
    seconds = float(argv[SECONDS_ARG]) if len(argv) > SECONDS_ARG else DEFAULT_SECONDS
    output_delay = engine_output_delay()
    events = capture(seconds)
    fixture = {"engine_output_delay": output_delay, "owner_spectrum_offset_s": offset, "events": events}
    out.write_text(json.dumps(fixture, indent=1) + "\n")
    times = [float(str(e["t_ms"])) for e in events]
    gaps = [b - a for a, b in itertools.pairwise(times)]
    print(f"{len(events)} events in {seconds}s -> {out}")
    print(f"engine output_delay={output_delay!r} owner offset={offset}s")
    print(f"gaps over 100 ms: {sum(g > GAP_OVER_MS for g in gaps)}, longest {max(gaps, default=0):.1f} ms")


if __name__ == "__main__":
    main(sys.argv[1:])
