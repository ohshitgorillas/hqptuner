"""Guards on `POST /api/matrix/filter` (spec `tests/specs/filter-upload-bdfd.txt`):
a parked filter must fit the per-file limit, fit the park's ceiling, and be a
WAVE container or text before it is kept for the next apply.

Written blind against the fake 8088 daemon alone. Refusals are matched by the
`code` wire identifier and the status class; `detail` is copy (docs/testing.md rule 9).
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import minimal_wave
from fastapi.testclient import TestClient
from httpx import Response
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The per-file limit the capped client is built with, in bytes; small so the
#: edge pair is a few KiB rather than the production default.
FILE_LIMIT = 4096

#: The park's ceiling on the total of everything already parked, in bytes.
PARK_CEILING = 256 * 1024 * 1024

#: The upload the park-ceiling pair sends: an even size, so the accepted case
#: is a well-formed container and fails for nothing but the ceiling.
FITTING = 1024

#: What `_code` reads off an answer whose body carries no `code`: a parked upload's.
NO_CODE = ""

#: The two outcomes of an upload, as the status class and the `code` each answers with.
STATUS_CLASS = {"parked": 2, "refused": 4}
CODE = {"parked": NO_CODE, "refused": "invalid_input"}


def _post(client: TestClient, name: str, body: bytes) -> Response:
    resp: Response = client.post("/api/matrix/filter", files={"file": (name, body, "application/octet-stream")})
    return resp


def _code(resp: Response) -> object:
    return resp.json().get("code", NO_CODE)


@pytest.fixture
def capped_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """`http_client` with `filter_max_bytes` pinned to FILE_LIMIT."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
        hqp_home="/x/home",
        filter_max_bytes=FILE_LIMIT,
    )
    with TestClient(create_app(cfg, VirtualClock())) as test_client:
        yield test_client


# --- line 1: per-file limit ----------------------------------------------------

FILE_LIMIT_PAIR = [
    pytest.param(FILE_LIMIT, "parked", id="at-limit"),
    pytest.param(FILE_LIMIT + 1, "refused", id="one-over"),
]


@pytest.mark.parametrize(("size", "outcome"), FILE_LIMIT_PAIR)
def test_a_file_parks_at_the_configured_limit_and_bounces_one_byte_over(
    capped_client: TestClient, size: int, outcome: str
) -> None:
    assert _post(capped_client, "probe.wav", minimal_wave(size)).status_code // 100 == STATUS_CLASS[outcome]


@pytest.mark.parametrize(("size", "outcome"), FILE_LIMIT_PAIR)
def test_a_file_over_the_configured_limit_and_only_that_one_carries_code_invalid_input(
    capped_client: TestClient, size: int, outcome: str
) -> None:
    assert _code(_post(capped_client, "probe.wav", minimal_wave(size))) == CODE[outcome]


# --- line 2: park ceiling --------------------------------------------------------

PARK_CEILING_PAIR = [
    pytest.param(FITTING, "parked", id="fills-the-park"),
    pytest.param(FITTING + 1, "refused", id="one-over"),
]


def _post_beside_a_nearly_full_park(client: TestClient, tmp_path: Path, size: int) -> Response:
    park = tmp_path / "pending-filters"
    park.mkdir(parents=True, exist_ok=True)
    with (park / "already.wav").open("wb") as parked:  # sparse: the park total is read by size
        parked.truncate(PARK_CEILING - FITTING)
    return _post(client, "probe.wav", minimal_wave(size))


@pytest.mark.parametrize(("size", "outcome"), PARK_CEILING_PAIR)
def test_an_upload_parks_up_to_the_park_ceiling_and_bounces_one_byte_over(
    http_client: TestClient, tmp_path: Path, size: int, outcome: str
) -> None:
    assert _post_beside_a_nearly_full_park(http_client, tmp_path, size).status_code // 100 == STATUS_CLASS[outcome]


@pytest.mark.parametrize(("size", "outcome"), PARK_CEILING_PAIR)
def test_an_upload_over_the_park_ceiling_and_only_that_one_carries_code_invalid_input(
    http_client: TestClient, tmp_path: Path, size: int, outcome: str
) -> None:
    assert _code(_post_beside_a_nearly_full_park(http_client, tmp_path, size)) == CODE[outcome]


# --- line 4: body shape ----------------------------------------------------------

BODIES = [
    pytest.param("junk.wav", b"RIFF" + bytes(40), "refused", id="riff-magic-then-nulls"),
    pytest.param("junk.txt", b"Pre\x00amp", "refused", id="txt-with-a-control-byte"),
    pytest.param("empty.txt", b"", "refused", id="empty-txt"),
    pytest.param("probe.wav", minimal_wave(), "parked", id="minimal-wave-container"),
    pytest.param("autoeq.txt", b"Preamp: -6.4 dB", "parked", id="rew-text-export"),
]


@pytest.mark.parametrize(("name", "body", "outcome"), BODIES)
def test_only_a_wave_container_or_text_body_is_parked(
    http_client: TestClient, name: str, body: bytes, outcome: str
) -> None:
    assert _post(http_client, name, body).status_code // 100 == STATUS_CLASS[outcome]


@pytest.mark.parametrize(("name", "body", "outcome"), BODIES)
def test_a_body_neither_wave_container_nor_text_carries_code_invalid_input(
    http_client: TestClient, name: str, body: bytes, outcome: str
) -> None:
    assert _code(_post(http_client, name, body)) == CODE[outcome]


# --- line 5: the route answers before framework validation does -------------------


def _post_without_a_filename(client: TestClient) -> Response:
    resp: Response = client.post("/api/matrix/filter", files={"file": ("", minimal_wave(), "audio/wav")})
    return resp


def test_an_empty_filename_is_refused_by_code(http_client: TestClient) -> None:
    assert _code(_post_without_a_filename(http_client)) == "invalid_input"


def test_an_empty_filename_is_a_client_error(http_client: TestClient) -> None:
    assert _post_without_a_filename(http_client).status_code // 100 == 4
