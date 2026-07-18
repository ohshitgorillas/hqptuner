"""HTTP config write side (POST /config, profile CRUD, backup) against a real
HTTP server on a real socket — no transport injection, no mock of our client
(docs/testing.md rule 4). The server records each request so tests can assert
what actually went over the wire."""

import threading
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from hqptuner.httpconf import HttpConfigClient

BACKUP_BLOB = b"BACKUP-BLOB"


def _handler(captured: list[tuple[str, str]]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            captured.append((self.path, self.rfile.read(length).decode()))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")

        def do_GET(self) -> None:
            captured.append((self.path, ""))
            if self.path == "/backup/settings.zip":  # only the real backup route serves the blob
                self.send_response(200)
                self.end_headers()
                self.wfile.write(BACKUP_BLOB)
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *_: object) -> None:
            pass

    return Handler


@pytest.fixture
def http_server() -> Iterator[tuple[int, list[tuple[str, str]]]]:
    captured: list[tuple[str, str]] = []
    server = HTTPServer(("127.0.0.1", 0), _handler(captured))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server.server_address[1], captured
    server.shutdown()
    thread.join()


@pytest.fixture
async def http_client(
    http_server: tuple[int, list[tuple[str, str]]],
) -> AsyncIterator[tuple[HttpConfigClient, list[tuple[str, str]]]]:
    port, captured = http_server
    client = HttpConfigClient("127.0.0.1", port, "u", "p")
    yield client, captured
    await client.aclose()


async def test_post_config_carries_the_apply_button(
    http_client: tuple[HttpConfigClient, list[tuple[str, str]]],
) -> None:
    client, captured = http_client
    await client.post_config({"channels": "2"})
    assert "Apply=Apply" in captured[0][1]


async def test_post_config_carries_the_field_value(
    http_client: tuple[HttpConfigClient, list[tuple[str, str]]],
) -> None:
    client, captured = http_client
    await client.post_config({"channels": "2"})
    assert "channels=2" in captured[0][1]


async def test_post_profile_load_hits_the_load_route(
    http_client: tuple[HttpConfigClient, list[tuple[str, str]]],
) -> None:
    client, captured = http_client
    await client.post_profile("load", profile="Speakers")
    assert captured[0][0] == "/config/profile/load"


async def test_post_profile_rejects_an_unknown_action(
    http_client: tuple[HttpConfigClient, list[tuple[str, str]]],
) -> None:
    client, _ = http_client
    with pytest.raises(ValueError, match="unknown profile action"):
        await client.post_profile("bogus", profile="x")


async def test_backup_returns_the_daemon_bytes(
    http_client: tuple[HttpConfigClient, list[tuple[str, str]]],
) -> None:
    client, _ = http_client
    assert await client.backup() == BACKUP_BLOB
