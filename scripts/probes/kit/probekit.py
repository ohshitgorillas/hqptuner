"""The daemon plumbing the live-daemon probes share: where it listens, how a probe waits on it, restarts it and refuses.

Each probe keeps its own question, its idle gate, its restore of what it changed and its ``State`` readback; what
lives here is only what every one of them needs to reach hqplayerd at all. A probe puts this directory on
``sys.path`` before importing the module.
"""

import asyncio
import io
import os
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.conf.httpforms import FormField
from hqptuner.engine.control import ControlClient

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
CONTROL_PORT = int(os.environ.get("HQPTUNER_HQP_CONTROL_PORT", "4321"))
OUT = Path(os.environ.get("PROBE_OUT") or tempfile.gettempdir()) / "hqptuner-probe"
ARCHIVE = OUT / "pristine-settings.zip"
SETTLE_TRIES = 40
SETTLE_WAIT = 1.0
PROFILE_POLLS = 30
PIN_TARGETS = ("352800", "176400")


class CliError(Exception):
    """A condition that stops a script cold; `run_cli` prints it and owns the exit code."""


def run_cli(run: Callable[[], int]) -> int:
    """Run a script's body, turning a `CliError` into a printed reason and exit code 1."""
    errors: list[CliError] = []
    result = 0
    try:
        result = run()
    except CliError as exc:
        errors.append(exc)
    if errors:
        print(errors[0], file=sys.stderr)
        return 1
    return result


def credentials() -> tuple[str, str]:
    """Return the daemon's management user and password from the environment, or refuse."""
    user, password = os.environ.get("HQPTUNER_HQP_USERNAME"), os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        message = "set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)"
        raise CliError(message)
    return user, password


async def connect_state() -> tuple[ControlClient, dict[str, str]]:
    """Open a Control API connection to the daemon and read its ``State`` through it."""
    control = ControlClient(HOST, CONTROL_PORT)
    await control.connect()
    return control, await control.get_state()


def open_http(user: str, password: str, timeout: float) -> HttpConfigClient:
    """Return the daemon's HTTP management client, with its request timeout in seconds."""
    return HttpConfigClient(HOST, HTTP_PORT, user, password, HttpOptions(timeout=timeout))


def open_raw(user: str, password: str, timeout: float) -> httpx.AsyncClient:
    """Return a digest-authenticated client on the daemon's web lane, for the forms the config client does not wrap."""
    return httpx.AsyncClient(
        base_url=f"http://{HOST}:{HTTP_PORT}", auth=httpx.DigestAuth(user, password), timeout=timeout
    )


def restart_daemon() -> None:
    """Restart hqplayerd.

    A config restore does NOT restart it (probe run 1: the unit's uptime was
    untouched across a restore), and the saved-profile registry is built at
    process start only — so a profile written into the config is invisible to
    ``MatrixListProfiles`` until the daemon comes back.
    """
    subprocess.run(["/usr/bin/sudo", "systemctl", "restart", "hqplayerd"], check=True)


async def settle(http: HttpConfigClient, tries: int = SETTLE_TRIES) -> None:
    """Wait for the daemon to serve again after a restore or a restart."""
    for _ in range(tries):
        try:
            await http.get_config()
            return
        except (httpx.HTTPError, OSError):
            await asyncio.sleep(SETTLE_WAIT)
    message = "daemon never came back"
    raise CliError(message)


async def rpc[T](make: Callable[[], Awaitable[T]]) -> T:
    """Any daemon call, retried through a restart window.

    Every step that follows a restore lands while the daemon restarts, so a
    connect attempt in that window is expected, not a failure.
    """
    last: Exception | None = None
    for _ in range(SETTLE_TRIES):
        try:
            return await make()
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            await asyncio.sleep(SETTLE_WAIT)
    message = f"daemon never answered: {last}"
    raise CliError(message)


async def backup(http: HttpConfigClient) -> bytes:
    """Return the daemon's own settings archive, retried through a restart window."""
    return await rpc(http.backup)


async def save_pristine(http: HttpConfigClient) -> bytes:
    """Capture the daemon's settings archive before any write, keep a copy at ``ARCHIVE``, and return it."""
    pristine = await backup(http)
    OUT.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_bytes(pristine)
    return pristine


async def working(http: HttpConfigClient, active: str | None) -> bytes:
    """Return the running config's working-member XML, from a fresh backup."""
    return engineconf.base_config_xml(await backup(http), active)


async def push(http: HttpConfigClient, backup_bytes: bytes, working_xml: bytes, active: str | None) -> bytes:
    """Restore an archive carrying ``working_xml`` as its working member, then read the running config back.

    Never trust the POST's own 200.
    """
    with zipfile.ZipFile(io.BytesIO(backup_bytes)) as z:
        member = engineconf.running_config_name(z.namelist(), active)
    if member is None:
        message = "cannot resolve the working config member"
        raise CliError(message)
    archive = engineconf.rewrite_zip(backup_bytes, {member: working_xml})
    await rpc(lambda: http.restore(archive, scope="system"))
    await settle(http)
    return await working(http, active)


def correction(fields: list[FormField]) -> dict[str, object]:
    """Return the running ``post_correction*`` form fields as a name-to-value map."""
    return {str(f["name"]): f.get("value") for f in fields if str(f.get("name", "")).startswith("post_correction")}


async def poll_correction(http: HttpConfigClient, was: dict[str, object] | None) -> dict[str, object]:
    """Poll the matrix form until the correction plugin moves off ``was``, giving up after 20 passes.

    ``None`` for ``was`` takes the first read. A reload takes ~6.5 s and /config keeps serving
    through it, so the form is read repeatedly rather than once.
    """
    current: dict[str, object] = {}
    for _ in range(20):
        current = correction((await rpc(http.get_matrix))["fields"])
        if current != was:
            return current
        await asyncio.sleep(1.0)
    return current


async def await_profile(control: ControlClient, profile: str) -> list[str]:
    """Poll the daemon's profile registry until ``profile`` is in it, reconnecting each pass.

    Registration lands only once the reload settles; an immediate list is stale.
    """
    names: list[str] = []
    for _ in range(PROFILE_POLLS):
        await control.close()
        await control.connect()
        names = await control.get_matrix_profiles()
        if profile in names:
            break
        await asyncio.sleep(1.0)
    return names


def index_of(items: list[dict[str, str]], hz: str) -> str | None:
    """Return the `RatesItem` index carrying this rate in Hz, or None if absent."""
    return next((str(item["index"]) for item in items if str(item.get("rate")) == hz), None)


def mode_index(items: list[dict[str, str]], name: str) -> str | None:
    """Return the index of the mode whose display name starts with this."""
    return next((str(i["index"]) for i in items if str(i.get("name", "")).upper().startswith(name)), None)


async def connect_playing(need: str) -> tuple[ControlClient, str, str] | None:
    """Connect and return the client with the live mode and rate, or None once it has said why not.

    ``need`` finishes the refusal that names a stopped transport.
    """
    client = ControlClient()
    await client.connect()
    state = await client.get_state()
    mode, rate = state.get("mode"), state.get("rate")
    if mode is None or rate is None:
        print("State reports no mode/rate — aborting, nothing changed")
        return None
    if state.get("state") != "2":
        print(f"engine not playing (state={state.get('state')!r}) — {need}")
        return None
    return client, mode, rate


async def restore_live(client: ControlClient, mode: str, rate: str, settle_wait: float = 0.0) -> int:
    """Put the live mode and rate back, verify by ``State`` readback, close the client, and return the exit code."""
    await client.set_command("SetMode", value=mode)
    await client.set_command("SetRate", value=rate)
    if settle_wait:
        await asyncio.sleep(settle_wait)
    final = await client.get_state()
    if (final.get("mode"), final.get("rate")) != (mode, rate):
        got = (final.get("mode"), final.get("rate"))
        print(f"  RESTORE MISMATCH: want {(mode, rate)!r}, got {got!r}")
        return 1
    status, _meta = await client.get_status()
    print(f"  restored, verified by readback (active_rate now {status.get('active_rate')!r})")
    await client.close()
    return 0
