"""The web app manifest and the icons it lists, as a browser installing the app fetches them."""

import struct

from fastapi.testclient import TestClient

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_width(body: bytes) -> int | None:
    """The pixel width in a PNG's IHDR chunk, or None when the body is not a PNG."""
    if body[:8] != PNG_SIGNATURE or body[12:16] != b"IHDR":
        return None
    width: int = struct.unpack(">I", body[16:20])[0]
    return width


def test_manifest_is_served_as_manifest_json(api_client: TestClient) -> None:
    content_type = api_client.get("/manifest.webmanifest").headers["content-type"]
    assert content_type.split(";")[0] == "application/manifest+json"


def test_every_listed_icon_is_a_png_of_its_declared_width(api_client: TestClient) -> None:
    icons = api_client.get("/manifest.webmanifest").json()["icons"]
    widths = [png_width(api_client.get(icon["src"]).content) for icon in icons]
    assert widths == [int(icon["sizes"].split("x")[0]) for icon in icons]
