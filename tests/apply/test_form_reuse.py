"""The 8088 form reads against the faithful fake daemon on a real socket: a page
whose body has not changed since the same getter last fetched it comes back as
the form already parsed from it, and a page that changed is parsed afresh.
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.conf.httpforms import ConfigForm


@pytest.fixture
async def client(http_daemon: dict[str, Any]) -> AsyncIterator[HttpConfigClient]:
    http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
    yield http
    await http.aclose()


def _title(form: ConfigForm) -> object:
    return next(f["value"] for f in form["fields"] if f["name"] == "title")


async def test_a_changed_config_page_is_parsed_afresh(client: HttpConfigClient, http_daemon: dict[str, Any]) -> None:
    await client.get_config()
    http_daemon["title"] = "Moved"
    assert _title(await client.get_config()) == "Moved"
