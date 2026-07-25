"""Speaker-processing apply (readme §1.9) over a real socket: the POST body the
daemon would receive is captured and asserted (docs/testing.md rule 4 — a real
server, never a stub of our client). The apply overlays the desired state onto a
fresh GET of the complete form, so the fixture is served on every GET."""

import threading
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs

import pytest

from hqptuner.conf.httpconf import HttpConfigClient

_FIXTURE = (Path(__file__).parent / "fixtures" / "speakers-6.0.4.html").read_text().encode()


def _handler(posts: list[dict[str, list[str]]]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(_FIXTURE)

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            posts.append(parse_qs(self.rfile.read(length).decode(), keep_blank_values=True))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")

        def log_message(self, *_: object) -> None:
            pass

    return Handler


@pytest.fixture
def server() -> Iterator[tuple[int, list[dict[str, list[str]]]]]:
    posts: list[dict[str, list[str]]] = []
    srv = HTTPServer(("127.0.0.1", 0), _handler(posts))
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv.server_address[1], posts
    srv.shutdown()
    thread.join()


@pytest.fixture
async def client(
    server: tuple[int, list[dict[str, list[str]]]],
) -> AsyncIterator[tuple[HttpConfigClient, list[dict[str, list[str]]]]]:
    port, posts = server
    c = HttpConfigClient("127.0.0.1", port, "u", "p")
    yield c, posts
    await c.aclose()


async def test_enabled_apply_sends_enabled_one(
    client: tuple[HttpConfigClient, list[dict[str, list[str]]]],
) -> None:
    c, posts = client
    await c.apply_speakers(True, {})
    assert posts[-1].get("enabled") == ["1"]


async def test_disabled_apply_omits_the_enabled_field(
    client: tuple[HttpConfigClient, list[dict[str, list[str]]]],
) -> None:
    c, posts = client
    await c.apply_speakers(False, {})
    assert "enabled" not in posts[-1]


@pytest.mark.parametrize("field,value", [("level", "5"), ("distance", "9999"), ("level", "abc")])
async def test_out_of_range_or_nonnumeric_value_is_rejected(
    client: tuple[HttpConfigClient, list[dict[str, list[str]]]],
    field: str,
    value: str,
) -> None:
    c, _ = client
    with pytest.raises(ValueError):
        await c.apply_speakers(True, {"0": {field: value}})


async def test_applied_level_reaches_the_wire(
    client: tuple[HttpConfigClient, list[dict[str, list[str]]]],
) -> None:
    c, posts = client
    await c.apply_speakers(True, {"0": {"level": "-3"}})
    assert posts[-1].get("level_0") == ["-3"]


async def test_partial_override_still_posts_a_complete_form(
    client: tuple[HttpConfigClient, list[dict[str, list[str]]]],
) -> None:
    c, posts = client
    await c.apply_speakers(True, {"0": {"level": "-3"}})
    expected = {f"{kind}_{i}" for kind in ("level", "distance") for i in range(8)}
    assert expected <= set(posts[-1])
