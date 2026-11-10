"""The fake 8088 `/config` page is the captured 6.0.4 page (docs/testing.md rule 13).

A test's choices come from the page, so the fake serves the capture whole and the fake 4321
enumerates the same filter, oversampling, dither and modulator IDs. Both pages are read by
`parse_config_form`, so the comparison is select for select and option for option.
"""

import contextlib
from collections.abc import Iterator
from pathlib import Path

import fake_http
import httpx
import pytest
from defusedxml.ElementTree import fromstring
from fake_control import DEFAULTS, handle
from fake_network import http_transport

from hqptuner.conf.formparse import parse_config_form
from hqptuner.conf.httpforms import ConfigForm, FormField

FIXTURE = Path(__file__).parent.parent.parent / "support" / "fixtures" / "config-form-6.0.4.html"
HOST = "127.0.0.1"
#: (the page's select, the fake 4321 command that enumerates it, the mode it answers in: 1 is PCM, 2 is SDM)
LISTS = (
    ("filter", "GetFilters", "1"),
    ("oversampling", "GetFilters", "2"),
    ("dither", "GetShapers", "1"),
    ("modulator", "GetShapers", "2"),
)
FIELD_TYPES = (("filter", "select"), ("samplerate", "select"), ("bitrate", "select"), ("channels", "number"))

_serving = contextlib.contextmanager(fake_http.spawn)


def _captured() -> ConfigForm:
    return parse_config_form(FIXTURE.read_text())


@contextlib.contextmanager
def _client(**state: object) -> Iterator[httpx.Client]:
    with (
        _serving(fake_http.state(**state), in_process=True) as daemon,
        httpx.Client(base_url="http://127.0.0.1", transport=http_transport(HOST, daemon["_port"])) as client,
    ):
        yield client


def _served(**state: object) -> ConfigForm:
    with _client(**state) as client:
        return parse_config_form(client.get("/config").text)


def _selects(form: ConfigForm) -> dict[str, list[str]]:
    return {
        f["name"]: [o["value"] for o in f["options"]]
        for f in form["fields"]
        if f["type"] == "select" and f["name"] is not None
    }


def _field(form: ConfigForm, name: str) -> FormField:
    return next(f for f in form["fields"] if f["name"] == name)


def _enumerated_ids(command: str, mode: str) -> list[str]:
    reply = handle(f"<{command}/>", {**DEFAULTS, "mode": mode})
    if not isinstance(reply, str):
        raise TypeError(command)
    return [item.get("value", "") for item in fromstring(reply)]


def test_fake_page_carries_the_same_select_fields_as_the_capture() -> None:
    assert _selects(_served()).keys() == _selects(_captured()).keys()


@pytest.mark.parametrize("name", sorted(_selects(_captured())))
def test_fake_page_select_carries_the_captures_options(name: str) -> None:
    assert _selects(_served()).get(name) == _selects(_captured())[name]


@pytest.mark.parametrize(("select", "command", "mode"), LISTS)
def test_fake_control_enumerates_the_pages_ids(select: str, command: str, mode: str) -> None:
    assert _enumerated_ids(command, mode) == _selects(_captured())[select]


@pytest.mark.parametrize(("name", "kind"), FIELD_TYPES)
def test_fake_page_field_has_the_captures_wire_type(name: str, kind: str) -> None:
    assert _field(_served(), name)["type"] == kind


def test_a_value_set_on_the_fake_state_is_the_selected_option() -> None:
    assert _field(_served(samplerate="96000"), "samplerate")["value"] == "96000"


def test_a_number_set_on_the_fake_state_is_the_inputs_value() -> None:
    assert _field(_served(channels="8"), "channels")["value"] == 8


def test_a_flag_set_on_the_fake_state_is_the_checked_box() -> None:
    assert _field(_served(auto_family=True), "auto_family")["value"] is True


def test_a_field_the_state_has_no_key_for_keeps_the_captures_value() -> None:
    assert _field(_served(), "alsa_bits")["value"] == _field(_captured(), "alsa_bits")["value"]


def test_fake_page_lists_the_endpoints_a_rescan_adds() -> None:
    extra = "naa-new/hw:CARD=New,DEV=0"
    with _client(_hidden_endpoints=[extra]) as client:
        client.get("/config/refresh")
        page = parse_config_form(client.get("/config").text)
    assert extra in _selects(page)["net_device"]
