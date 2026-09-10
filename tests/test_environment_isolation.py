"""What a test body inherits from the shell that started the suite.

The suite is run from shells that carry ``HQPTUNER_*`` variables for reasons of
their own - sourced credentials, a browser pointer, a hand-set store path - and
a test body that reads one of those instead of the harness's own is a test of
the machine it ran on. So the observation here is made in a CHILD pytest run,
started with a shell environment this file writes itself: the child runs the
version canary, ``tests/support/env_probe.py`` records what each body sees, and
the fake 8088 daemon records what the canary's fetch actually dialed and with
which credentials.

Nothing here reads the parent's own environment, and the child's pass/fail
verdict is never consulted - only its records.
"""

import hashlib
import json
import os
import re
import socket
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest

#: The repo the child run is started against: this file's own checkout, never
#: the working directory (docs/testing.md rule 16).
REPO_ROOT = Path(__file__).resolve().parent.parent

#: What the child's "shell" exports. A credential and a store path the harness
#: is expected to scrub, a browser pointer it is expected to leave alone, and
#: the address of the fake daemon the canary is meant to reach.
SHELL_CREDENTIAL = "shell"
SHELL_CHROMIUM = "/shell/chromium"
SHELL_CONNECTION_FILE = "/shell/connection.json"
SHELL_HOST = "127.0.0.1"

#: The nine store paths the state guard parks under its own tmp dir, written out
#: rather than imported from the guard's table: a guard that lost one of them
#: from its table would otherwise lose it from the expectation too.
STORE_PATH_ENVS = (
    "HQPTUNER_AUTOPILOT_FILE",
    "HQPTUNER_CONNECTION_FILE",
    "HQPTUNER_LIVE_PRESET_FILE",
    "HQPTUNER_FAVORITES_FILE",
    "HQPTUNER_NARROWING_FILE",
    "HQPTUNER_DESCRIPTION_FILE",
    "HQPTUNER_MATRIX_MODE_FILE",
    "HQPTUNER_BACKUP_DIR",
    "HQPTUNER_PRESET_DIR",
)

METERING_PORT_ENV = "HQPTUNER_HQP_METERING_PORT"

#: hqplayerd's stock management pair (hqplayerd-readme.txt, and this repo's
#: README): what a `Config()` with no credential in its environment falls back
#: to.
STOCK_CREDENTIAL = "password"

#: The daemon's own default management port, likewise the fallback with no
#: `HQPTUNER_HQP_HTTP_PORT` in the environment.
DEFAULT_HTTP_PORT = 8088

#: Ceiling on the child run, not a duration anything is expected to take: the
#: child is three GETs against a loopback fake plus a collection.
CHILD_RUN_CEILING_SECONDS = 300


def _child_environment(daemon_port: int, out: Path, temproot: Path) -> dict[str, str]:
    """The shell the child is started from: this process's environment with
    every `HQPTUNER_*` name of its own dropped, plus the pollution above.
    `PYTEST_DEBUG_TEMPROOT` is where the child's own session tmp dir lands, so
    the parent can tell one from any other path."""
    env = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith(("HQPTUNER_", "PYTEST_ADDOPTS", "COV_CORE_", "COVERAGE_"))
    }
    env.update(
        {
            "HQPTUNER_HQP_PASSWORD": SHELL_CREDENTIAL,
            "HQPTUNER_CHROMIUM": SHELL_CHROMIUM,
            "HQPTUNER_CONNECTION_FILE": SHELL_CONNECTION_FILE,
            "HQPTUNER_HQP_HOST": SHELL_HOST,
            "HQPTUNER_HQP_HTTP_PORT": str(daemon_port),
            "ENV_PROBE_OUT": str(out),
            "PYTEST_DEBUG_TEMPROOT": str(temproot),
        }
    )
    return env


def _digest_fields(header: str) -> dict[str, str]:
    """The parameters of an RFC 2617 ``Authorization: Digest`` header, quoted
    (``nonce``, ``cnonce``, ``response``) and bare (``qop``, ``nc``) alike."""
    return {name: quoted or bare for name, quoted, bare in re.findall(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', header)}


def _digest_password(record: dict[str, str], candidates: tuple[str, ...]) -> str | None:
    """Which of `candidates` the sender of this digest holds, or None for none of
    them: the response hash is recomputed per RFC 2617 from the header's own
    nonce, cnonce, count and URI, so the password is read off the wire rather
    than taken from anybody's configuration."""
    fields = _digest_fields(record["header"])

    def md5(text: str) -> str:
        return hashlib.md5(text.encode(), usedforsecurity=False).hexdigest()

    ha2 = md5(f"{record['method']}:{fields.get('uri', '')}")
    for candidate in candidates:
        ha1 = md5(f"{fields.get('username', '')}:{fields.get('realm', '')}:{candidate}")
        if fields.get("qop"):
            expected = md5(f"{ha1}:{fields['nonce']}:{fields['nc']}:{fields['cnonce']}:{fields['qop']}:{ha2}")
        else:
            expected = md5(f"{ha1}:{fields.get('nonce', '')}:{ha2}")
        if expected == fields.get("response"):
            return candidate
    return None


def _refuses_connection(port: int) -> bool:
    """Whether a TCP connect to loopback on `port` is refused - no listener."""
    with socket.socket() as sock:
        sock.settimeout(2.0)
        return sock.connect_ex(("127.0.0.1", port)) != 0


@pytest.fixture(scope="module")
def challenging_daemon() -> Iterator[dict[str, Any]]:
    """The 8088 fake on an ephemeral port, greeting every fresh connection with
    the 401 digest challenge, so whatever the canary dials it with lands in
    `_authorizations`."""
    yield from fake_http.spawn(fake_http.state(_challenge_auth=True))


@pytest.fixture(scope="module")
def polluted_run(tmp_path_factory: pytest.TempPathFactory, challenging_daemon: dict[str, Any]) -> dict[str, Any]:
    """One child pytest run of the canary under the polluted shell, with what it
    left behind: the probe's per-body records, the tmp root the child's own
    session was given, and the credentials that reached the fake."""
    tmp = tmp_path_factory.mktemp("polluted-run")
    out = tmp / "env-probe.jsonl"
    temproot = tmp / "child-tmp"
    temproot.mkdir()
    port = int(challenging_daemon["_port"])
    completed = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/live/test_live_forms.py", "-q", "-p", "env_probe"],
        cwd=REPO_ROOT,
        env=_child_environment(port, out, temproot),
        capture_output=True,
        text=True,
        timeout=CHILD_RUN_CEILING_SECONDS,
        check=False,
    )
    records = [json.loads(line) for line in out.read_text().splitlines()] if out.exists() else []
    if not records:
        raise RuntimeError(f"the child run reached no test body:\n{completed.stdout}\n{completed.stderr}")
    return {
        "body": records[0],
        "temproot": temproot,
        "daemon_port": port,
        "authorizations": list(challenging_daemon["_authorizations"]),
    }


def _visible_environment(run: dict[str, Any]) -> dict[str, str]:
    """The `HQPTUNER_*` mapping the child's first test body saw, with the two
    relational expectations resolved: a value under the child session's own tmp
    root reads as `session-tmp`, and the metering port as `closed` when nothing
    is listening on it."""
    temproot = Path(run["temproot"]).resolve()
    visible = {}
    for name, value in run["body"]["env"].items():
        if name == METERING_PORT_ENV:
            visible[name] = "closed" if _refuses_connection(int(value)) else "open"
        elif temproot in Path(value).resolve().parents:
            visible[name] = "session-tmp"
        else:
            visible[name] = value
    return visible


def _bracket_pair(run: dict[str, Any]) -> tuple[int | None, str | None]:
    """The address and password the canary's own fetch reached the daemon with,
    read off the wire: the port is the fake's, since a request arrived there at
    all, and the password is the one behind the digest. `(None, None)` when
    nothing reached the fake."""
    if not run["authorizations"]:
        return None, None
    return run["daemon_port"], _digest_password(run["authorizations"][0], (SHELL_CREDENTIAL, STOCK_CREDENTIAL))


def test_a_test_body_sees_only_the_environment_the_session_guards_install(polluted_run: dict[str, Any]) -> None:
    assert _visible_environment(polluted_run) == {
        **dict.fromkeys(STORE_PATH_ENVS, "session-tmp"),
        METERING_PORT_ENV: "closed",
        "HQPTUNER_CHROMIUM": SHELL_CHROMIUM,
    }


def test_a_config_falls_back_in_a_body_and_reads_the_shell_inside_the_canarys_bracket(
    polluted_run: dict[str, Any],
) -> None:
    body = polluted_run["body"]
    assert ((body["hqp_http_port"], body["hqp_password"]), _bracket_pair(polluted_run)) == (
        (DEFAULT_HTTP_PORT, STOCK_CREDENTIAL),
        (polluted_run["daemon_port"], SHELL_CREDENTIAL),
    )
