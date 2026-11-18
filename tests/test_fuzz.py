"""``scripts/fuzz/fuzz.py``'s ``probe``: the health check sent after every attack.

``probe(client)`` must not let a transport failure escape as anything other than
the error it raises; the caller (``Run.one``/``Run.parallel``) is the one that
turns that into a recorded ``ProbeResult``. Lives in ``scripts/fuzz/``,
which is not a package, so it is loaded by path — the same pattern
``tests/test_build_manual.py`` uses for its own script-under-test.
"""

import io
import socket
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import httpx
import pytest
from conftest import load_script, miniature_repo

#: The fuzz scripts directory, found relative to this file rather than through an import.
SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts" / "fuzz"


@pytest.fixture
def fuzz(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return load_script(SCRIPTS_DIR, "fuzz", monkeypatch)


#: The connect failure a refusing transport raises.
_REFUSED = "refused"


def _refuse(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError(_REFUSED, request=request)


def test_probe_raises_probe_failed_error_on_a_connect_error(fuzz: ModuleType) -> None:
    """A transport that refuses the connection surfaces as ``fuzz.ProbeFailedError``, not a return value."""
    with (
        httpx.Client(transport=httpx.MockTransport(_refuse), base_url="http://test") as client,
        pytest.raises(fuzz.ProbeFailedError),
    ):
        fuzz.probe(client)


def _state_fails(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/state":
        return httpx.Response(500, text="Internal Server Error")
    return httpx.Response(200, json={})


def test_gated_raises_state_unavailable_error_for_apply_when_state_route_fails(fuzz: ModuleType) -> None:
    """An apply-class attack whose state read answers 500 surfaces as ``fuzz.StateUnavailableError`` from ``gated``."""
    attack = fuzz.Attack(category=0, method="POST", path="/api/apply", note="apply", klass="apply")
    with (
        httpx.Client(transport=httpx.MockTransport(_state_fails), base_url="http://test") as client,
        pytest.raises(fuzz.StateUnavailableError),
    ):
        fuzz.Run(client, io.StringIO()).gated(attack)


#: An image recipe in the repo's shape, naming one store under ``/state``.
RECIPE = "FROM python:3.12-slim\nENV HQPTUNER_TALLY_FILE=/state/tally.json \\\n    HQPTUNER_LISTEN_HOST=0.0.0.0\n"

#: What ``abuse.sh open`` writes to ``abuse/current``: the run's stamp, then the newest audit seq.
OPEN_RUN = "20261012T080000Z 41\n"

#: The host lines ``hqpcreds`` carries beside the abuse root, in its ``NAME=value`` shape.
CHROMIUM_LINE = "HQPTUNER_CHROMIUM=/usr/bin/chromium"
USERNAME_LINE = "HQPTUNER_HQP_USERNAME=hqplayer"

#: The state root ``hqpcreds`` names, and the one the environment override names.
HOST_ROOT = "host-root"
OVERRIDE_ROOT = "override-root"


@pytest.fixture
def dead_api(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Point the bracket's API knob at a loopback port that is held but never listened on."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
        held.bind(("127.0.0.1", 0))
        monkeypatch.setenv("HQPTUNER_ABUSE_API", f"http://127.0.0.1:{held.getsockname()[1]}")
        yield


def with_open_run(tmp_path: Path, name: str) -> Path:
    """A state root under ``tmp_path`` holding an open run, as ``abuse.sh open`` leaves it."""
    root = tmp_path / name
    (root / "abuse").mkdir(parents=True)
    (root / "abuse" / "current").write_text(OPEN_RUN, encoding="utf-8")
    return root


def repo_naming(tmp_path: Path, host_root: Path | None) -> Path:
    """A miniature repo whose ``hqpcreds`` names ``host_root`` between two other host lines, unless it is None."""
    creds = None if host_root is None else f"{CHROMIUM_LINE}\nHQPTUNER_ABUSE_STATE={host_root}\n{USERNAME_LINE}\n"
    return miniature_repo(tmp_path, RECIPE, creds)


@pytest.mark.parametrize(
    ("host_root", "override", "found"),
    [(HOST_ROOT, None, HOST_ROOT), (HOST_ROOT, OVERRIDE_ROOT, OVERRIDE_ROOT), (None, OVERRIDE_ROOT, OVERRIDE_ROOT)],
    ids=["hqpcreds names the root", "the override outranks hqpcreds", "the override, no hqpcreds"],
)
@pytest.mark.usefixtures("dead_api")
def test_open_bracket_finds_the_run_open_under_the_state_root_abuse_sh_resolves(
    fuzz: ModuleType,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    host_root: str | None,
    override: str | None,
    found: str,
) -> None:
    repo = repo_naming(tmp_path, None if host_root is None else with_open_run(tmp_path, host_root))
    monkeypatch.delenv("HQPTUNER_ABUSE_STATE", raising=False)
    if override is not None:
        monkeypatch.setenv("HQPTUNER_ABUSE_STATE", str(with_open_run(tmp_path, override)))
    assert fuzz.open_bracket(repo) == tmp_path / found / "abuse" / "current"
