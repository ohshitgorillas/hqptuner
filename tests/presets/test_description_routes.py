"""The two surfaces built over `DescriptionStore`: the GET/PUT
`/api/descriptions` pair, and the carriage of the store through a settings
archive — the two zip helpers plus the backup/restore routes that use them.

The store itself — reading, writing, validation, merging, export — is pinned in
``tests/presets/test_description_store.py``. The suite is cut there because
everything in this file needs an app and a client, and half of it needs a daemon,
while nothing in the store file needs any of the three.

A description is keyed by profile NAME, the stable join key
(docs/architecture.md §2) — `<matrix_profile>` carries exactly one attribute,
`name` (hqplayerd-readme.txt §1.12), so there is nowhere in the config XML for
prose to live and the store is HQPTuner's own state. The REST pair therefore
never touches hqplayerd: those clients are built with no credentials and a
control lane pointed at a closed port, so a route that answers at all answered
without the daemon. The carriage cases DO talk to the daemon, through the
faithful fake 8088 daemon, because "the daemon's own members survive
byte-for-byte" is a claim about a real archive and the reference for it has to
come off the daemon's own `GET /backup`.

Every store file lands under pytest's ``tmp_path``, never in the repo's state
dir. The on-disk layout — ``{"schema": N, "profiles": {name: {"text", "updated"}}}``
— is the contract a DIFFERENT HQPTuner version reads, so the cases about a
foreign file or a carried payload hand-write one, the way a wire test hand-writes
a frame.
"""

import contextlib
import io
import json
import zipfile
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.conf.presetzip import DESCRIPTIONS_MEMBER, embed_descriptions, take_descriptions
from hqptuner.config import Config
from hqptuner.presets.store.descriptions import DescriptionError, DescriptionStore

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = {"schema": 99, "profiles": {"Living Room": {"text": "warm", "updated": "2024-01-01T00:00:00+00:00"}}}

#: A stamp left by an earlier write, far enough in the past that no write made
#: during a test run can land on it.
ANCIENT = "2000-01-01T00:00:00+00:00"

NAME = "Living Room"
TEXT = "Wide stereo, gentle tilt below 200 Hz."


def store_at(tmp_path: Path) -> DescriptionStore:
    return DescriptionStore(tmp_path / "descriptions.json")


def seed(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "descriptions.json"
    path.write_text(content)
    return path


def stamped(profiles: dict[str, dict[str, str]]) -> bytes:
    """A store file as another HQPTuner would have left it."""
    return json.dumps({"schema": 1, "profiles": profiles}).encode()


def entry(text: str, updated: str = ANCIENT) -> dict[str, str]:
    return {"text": text, "updated": updated}


def members(zip_bytes: bytes) -> dict[str, bytes]:
    archive = zipfile.ZipFile(io.BytesIO(zip_bytes))
    return {name: archive.read(name) for name in archive.namelist()}


@pytest.fixture
def descriptions_api(tmp_path: Path, closed_port: int) -> Iterator[Callable[[], TestClient]]:
    """The REST surface over a description file in ``tmp_path``, daemonless.

    A factory rather than a plain client so a case can hand-write a file another
    HQPTuner version stamped and then open the app over it. Nothing here can
    reach hqplayerd — the control lane points at `closed_port`, which nothing
    listens on — so a route that answers at all answered without the daemon."""
    clients: list[TestClient] = []

    def build() -> TestClient:
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=closed_port,
            hqp_username="",
            hqp_password="",
            description_file=tmp_path / "descriptions.json",
        )
        client = TestClient(create_app(cfg))
        clients.append(client)
        client.__enter__()
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def desc_client(descriptions_api: Callable[[], TestClient]) -> TestClient:
    return descriptions_api()


@pytest.fixture
def carriage_client(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int
) -> Iterator[tuple[TestClient, DescriptionStore]]:
    """The backup/restore routes wired to the fake 8088 daemon, over a
    description store in ``tmp_path``. The store is handed back alongside the
    client so a case can state what was stored before a backup and read what a
    restore left behind, without going through the REST pair it is not testing."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        description_file=tmp_path / "descriptions.json",
    )
    with TestClient(create_app(cfg)) as test_client:
        yield test_client, DescriptionStore(tmp_path / "descriptions.json")


def upload(client: TestClient, data: bytes) -> Any:
    return client.post("/api/restore", files={"cfgfile": ("settings.zip", data, "application/zip")})


# --- the REST pair -------------------------------------------------------------------


def test_a_fresh_install_answers_get_with_200(desc_client: TestClient) -> None:
    assert desc_client.get("/api/descriptions").status_code == 200


def test_put_then_get_answers_with_the_stored_text(desc_client: TestClient) -> None:
    desc_client.put("/api/descriptions", json={"name": NAME, "text": TEXT})
    assert desc_client.get("/api/descriptions").json()["profiles"][NAME]["text"] == TEXT


def test_a_served_entry_carries_the_stamp_of_its_write(desc_client: TestClient) -> None:
    desc_client.put("/api/descriptions", json={"name": NAME, "text": TEXT})
    served = desc_client.get("/api/descriptions").json()["profiles"][NAME]["updated"]
    assert datetime.fromisoformat(served).utcoffset().total_seconds() == 0  # type: ignore[union-attr]


def test_put_answers_with_the_whole_map_so_no_follow_up_get_is_needed(desc_client: TestClient) -> None:
    desc_client.put("/api/descriptions", json={"name": "Study", "text": "near field"})
    answer = desc_client.put("/api/descriptions", json={"name": NAME, "text": TEXT})
    assert sorted(answer.json()["profiles"]) == ["Living Room", "Study"]


def test_putting_blank_text_drops_the_entry(desc_client: TestClient) -> None:
    desc_client.put("/api/descriptions", json={"name": NAME, "text": TEXT})
    desc_client.put("/api/descriptions", json={"name": NAME, "text": "   "})
    assert NAME not in desc_client.get("/api/descriptions").json()["profiles"]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"name": "", "text": TEXT}, id="empty-name"),
        pytest.param({"name": "x" * 129, "text": TEXT}, id="129-char-name"),
        pytest.param({"name": "Living\x07Room", "text": TEXT}, id="control-char-name"),
        pytest.param({"name": NAME, "text": "x" * 2001}, id="2001-char-text"),
        pytest.param({"name": NAME, "text": "warm\x00room"}, id="control-char-text"),
    ],
)
def test_a_put_the_store_would_refuse_answers_422(desc_client: TestClient, body: object) -> None:
    assert desc_client.put("/api/descriptions", json=body).status_code == 422


def refusal(tmp_path: Path, name: str, text: str) -> str:
    """The sentence the store itself gives for a write it refuses, JSON-escaped
    so it can be looked for inside a rendered answer verbatim — a message
    quoting the offending name carries control characters the answer escapes.

    A store that ACCEPTS the write yields a sentence nothing can contain, rather
    than the empty string every answer trivially contains: the caller below is
    checking that a route repeats this sentence, and a write that stopped being
    refused must fail that check rather than satisfy it. An EMPTY refusal is the
    same hole from the other side — every answer contains it — so the store
    saying nothing is a failure here, not a pass."""
    try:
        store_at(tmp_path).write(name, text)
    except DescriptionError as exc:
        assert str(exc), "the store refused the write without saying why"
        return json.dumps(str(exc))[1:-1]
    return "\x00the store accepted a write it should have refused"


# The message is not pinned word for word — what is pinned is that the sentence
# the user is shown is the store's own, so a route inventing its own wording for
# a refusal it did not diagnose fails here whatever the store ends up saying.
# Name cases as well as text: FastAPI's own body validation also answers 422, so
# a status code alone cannot say the route ever consulted the store about a name.
@pytest.mark.parametrize(
    ("name", "text"),
    [
        pytest.param("", TEXT, id="empty-name"),
        pytest.param("x" * 129, TEXT, id="129-char-name"),
        pytest.param("Living\x07Room", TEXT, id="control-char-name"),
        pytest.param(NAME, "x" * 2001, id="2001-char-text"),
        pytest.param(NAME, "warm\x00room", id="control-char-text"),
    ],
)
def test_a_refused_put_answers_with_the_stores_own_message(
    desc_client: TestClient, tmp_path: Path, name: str, text: str
) -> None:
    answer = desc_client.put("/api/descriptions", json={"name": name, "text": text})
    assert refusal(tmp_path, name, text) in json.dumps(answer.json())


def test_get_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, descriptions_api: Callable[[], TestClient]
) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    assert descriptions_api().get("/api/descriptions").status_code == 409


def test_put_against_a_store_stamped_by_a_newer_hqptuner_answers_409(
    tmp_path: Path, descriptions_api: Callable[[], TestClient]
) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    answer = descriptions_api().put("/api/descriptions", json={"name": NAME, "text": TEXT})
    assert answer.status_code == 409


# The read direction is pinned by every GET case above, all of which run against
# this same daemonless client; what is left to say is that a WRITE lands too.
def test_a_description_is_written_with_no_daemon_reachable(desc_client: TestClient) -> None:
    assert desc_client.put("/api/descriptions", json={"name": NAME, "text": TEXT}).status_code == 200


# --- the two zip helpers -------------------------------------------------------------


def test_an_embedded_payload_comes_back_out() -> None:
    base = stamped({NAME: entry("warm")})
    archive = embed_descriptions(members_zip(), base)
    assert take_descriptions(archive)[1] == base


def test_taking_the_payload_removes_its_member() -> None:
    archive = embed_descriptions(members_zip(), stamped({NAME: entry("warm")}))
    assert DESCRIPTIONS_MEMBER not in members(take_descriptions(archive)[0])


def test_taking_the_payload_leaves_every_other_member_byte_identical() -> None:
    plain = members_zip()
    archive = embed_descriptions(plain, stamped({NAME: entry("warm")}))
    assert members(take_descriptions(archive)[0]) == members(plain)


def test_an_archive_with_no_payload_yields_no_payload() -> None:
    assert take_descriptions(members_zip())[1] is None


def test_an_archive_with_no_payload_comes_back_unchanged() -> None:
    plain = members_zip()
    assert take_descriptions(plain)[0] == plain


def members_zip() -> bytes:
    """An archive shaped the way hqplayerd's own /backup is: a working config
    and the data tree beside it (docs/protocol.md §3.6)."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("hqplayerd.xml", b"<hqplayer/>")
        z.writestr("data/library.xml", b"<library/>")
    return out.getvalue()


# --- carriage through backup ----------------------------------------------------------


def test_a_backup_carries_the_descriptions_member(carriage_client: tuple[TestClient, DescriptionStore]) -> None:
    client, store = carriage_client
    store.write(NAME, TEXT)
    assert DESCRIPTIONS_MEMBER in members(client.get("/api/backup").content)


def test_the_carried_member_holds_the_stored_text(carriage_client: tuple[TestClient, DescriptionStore]) -> None:
    client, store = carriage_client
    store.write(NAME, TEXT)
    carried = json.loads(members(client.get("/api/backup").content)[DESCRIPTIONS_MEMBER])
    assert carried["profiles"][NAME]["text"] == TEXT


def test_an_empty_store_adds_no_member(carriage_client: tuple[TestClient, DescriptionStore]) -> None:
    client, _store = carriage_client
    assert DESCRIPTIONS_MEMBER not in members(client.get("/api/backup").content)


def daemon_backup(http_daemon: dict[str, Any]) -> dict[str, bytes]:
    """The members of the archive hqplayerd itself serves, read straight off the
    fake's own `GET /backup/settings.zip` (docs/protocol.md §3.6).

    The reference for "the daemon's own members survive" has to come from the
    daemon, not from another trip through HQPTuner: a backup that mangled a
    member on every call would agree with itself while the user's
    `data/library.xml` came back wrong."""
    with httpx.Client(base_url=f"http://127.0.0.1:{http_daemon['_port']}") as raw:
        return members(raw.get("/backup/settings.zip").content)


def test_a_backup_leaves_the_daemons_own_members_byte_identical(
    carriage_client: tuple[TestClient, DescriptionStore], http_daemon: dict[str, Any]
) -> None:
    client, store = carriage_client
    plain = daemon_backup(http_daemon)
    store.write(NAME, TEXT)
    carried = members(client.get("/api/backup").content)
    assert {name: body for name, body in carried.items() if name != DESCRIPTIONS_MEMBER} == plain


def test_a_backup_is_still_a_zip_download_with_descriptions_carried(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, store = carriage_client
    store.write(NAME, TEXT)
    assert client.get("/api/backup").headers["content-type"] == "application/zip"


# --- carriage through restore -----------------------------------------------------------


def test_a_restore_merges_the_carried_descriptions(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, store = carriage_client
    upload(client, embed_descriptions(client.get("/api/backup").content, stamped({NAME: entry("warm")})))
    assert store.read()[NAME]["text"] == "warm"


def test_a_restore_keeps_a_description_the_archive_did_not_carry(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, store = carriage_client
    store.write("Study", "near field")
    upload(client, embed_descriptions(client.get("/api/backup").content, stamped({NAME: entry("warm")})))
    assert store.read()["Study"]["text"] == "near field"


def test_a_restore_forwards_an_archive_without_the_descriptions_member(
    carriage_client: tuple[TestClient, DescriptionStore], http_daemon: dict[str, Any]
) -> None:
    client, _store = carriage_client
    upload(client, embed_descriptions(client.get("/api/backup").content, stamped({NAME: entry("warm")})))
    assert DESCRIPTIONS_MEMBER not in http_daemon["_restore_members"]


def test_a_restore_forwards_every_other_member_byte_identical(
    carriage_client: tuple[TestClient, DescriptionStore], http_daemon: dict[str, Any]
) -> None:
    client, _store = carriage_client
    plain = client.get("/api/backup").content
    upload(client, embed_descriptions(plain, stamped({NAME: entry("warm")})))
    assert members(http_daemon["_restore_bytes"]) == members(plain)


def test_a_restore_carrying_descriptions_still_reports_restored(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, _store = carriage_client
    archive = embed_descriptions(client.get("/api/backup").content, stamped({NAME: entry("warm")}))
    assert upload(client, archive).json()["restored"] is True


# --- an archive carrying nothing of ours ------------------------------------------------


def test_a_restore_with_no_carried_member_changes_no_descriptions(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, store = carriage_client
    store.write(NAME, TEXT)
    upload(client, client.get("/api/backup").content)
    assert store.read()[NAME]["text"] == TEXT


def test_a_restore_with_no_carried_member_forwards_the_bytes_unchanged(
    carriage_client: tuple[TestClient, DescriptionStore], http_daemon: dict[str, Any]
) -> None:
    client, _store = carriage_client
    plain = client.get("/api/backup").content
    upload(client, plain)
    assert http_daemon["_restore_bytes"] == plain


# The daemon refuses an upload that is not a settings archive, and how the route
# reports that refusal is pre-existing behavior no part of this spec speaks to —
# hence the suppression. What is under test is that an upload HQPTuner cannot
# read is still the user's upload: it reaches the daemon as it was sent, and it
# does not disturb prose it never mentioned.


def test_a_non_zip_upload_changes_no_descriptions(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, store = carriage_client
    store.write(NAME, TEXT)
    with contextlib.suppress(Exception):
        upload(client, b"this is not a zip at all")
    assert store.read()[NAME]["text"] == TEXT


def test_a_non_zip_upload_is_forwarded_unchanged(
    carriage_client: tuple[TestClient, DescriptionStore], http_daemon: dict[str, Any]
) -> None:
    client, _store = carriage_client
    with contextlib.suppress(Exception):
        upload(client, b"this is not a zip at all")
    assert http_daemon["_restore_bytes"] == b"this is not a zip at all"


# --- a carried member this HQPTuner cannot read -------------------------------------------
# The archive came from somewhere else and its descriptions member is rubbish.
# The settings restore is the point of the upload; the prose riding along must
# not be able to fail it, and must not take the existing prose down with it.


def test_an_unreadable_carried_member_leaves_the_store_untouched(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, store = carriage_client
    store.write(NAME, TEXT)
    upload(client, embed_descriptions(client.get("/api/backup").content, b"not json at all {"))
    assert store.read()[NAME]["text"] == TEXT


def test_an_unreadable_carried_member_does_not_fail_the_restore(
    carriage_client: tuple[TestClient, DescriptionStore],
) -> None:
    client, _store = carriage_client
    archive = embed_descriptions(client.get("/api/backup").content, b"not json at all {")
    assert upload(client, archive).json()["restored"] is True


def test_an_unreadable_carried_member_is_still_stripped_before_forwarding(
    carriage_client: tuple[TestClient, DescriptionStore], http_daemon: dict[str, Any]
) -> None:
    client, _store = carriage_client
    upload(client, embed_descriptions(client.get("/api/backup").content, b"not json at all {"))
    assert DESCRIPTIONS_MEMBER not in http_daemon["_restore_members"]
