"""A staged value carrying a control character is refused: the config file cannot hold it and read it back.

A C0 control character other than tab, line feed and carriage return is not allowed in an XML document at all; those
three are allowed but the daemon's parser reads each back as a space.
"""

import pytest
from fastapi.testclient import TestClient


def _pending(client: TestClient) -> dict[str, dict[str, str]]:
    pending: dict[str, dict[str, str]] = client.get("/api/config/pending").json()
    return pending


@pytest.mark.parametrize("char", ["\x01", "\x00", "\x1f", "\t", "\n", "\r"])
def test_a_text_value_with_a_control_character_is_refused(http_client: TestClient, char: str) -> None:
    resp = http_client.post("/api/config/stage", json={"http": {"title": f"a{char}b"}})
    assert resp.json()["code"] == "invalid_input"


def test_a_number_value_with_a_control_character_is_refused(http_client: TestClient) -> None:
    resp = http_client.post("/api/config/stage", json={"http": {"fixed_volume": "-3\x01"}})
    assert resp.json()["code"] == "invalid_input"


def test_a_refused_control_character_leaves_the_buffer_unchanged(http_client: TestClient) -> None:
    http_client.post("/api/config/stage", json={"http": {"title": "kept"}})
    http_client.post("/api/config/stage", json={"http": {"title": "a\x01b", "log_file": "fine"}})
    assert _pending(http_client)["http"] == {"title": "kept"}


def test_a_value_with_markup_characters_and_no_control_character_still_stages(http_client: TestClient) -> None:
    resp = http_client.post("/api/config/stage", json={"http": {"title": "a\"b<c>d&e'f"}})
    assert resp.status_code == 200
