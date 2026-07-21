"""Shared fixtures: a stateful fake hqplayerd speaking real Control API XML
over a real socket (docs/testing.md — fakes speak the wire protocol).

The fake keeps a per-connection settings dict and answers setters + State from
it, so a `Set*` followed by `State` reads back the change — enough to exercise
the readback-verify path. Two quirks are modelled for the write-path tests:
`value="999"` returns `result="OK"` without applying (the OK-but-not-applied
caveat, protocol.md §6); `value="err"` returns `result="Error"`; and `SetMode`
resets `rate` to `0` (mode swaps the lists rate is relative to), which lets a
test prove apply order (mode before rate).

The port-8088 HTTP fake lives in `fake_http`; its fixtures are at the bottom."""

import asyncio
import functools
from collections.abc import AsyncIterator, Iterator
from typing import Any

import fake_http
import pytest
from defusedxml.ElementTree import fromstring as _fromstring

from hqptuner.control import ControlClient

XML = '<?xml version="1.0" encoding="UTF-8"?>'

_DEFAULTS = {
    "state": "0",
    "mode": "1",
    "filter1x": "0",
    "filterNx": "0",
    "shaper": "0",
    "rate": "0",
    "filter_junk": "0",
    "adaptive": "0",
    "volume": "-10.0",
    "matrix_profile": "",
    # underscore keys are internal to the fake (VolumeRange source), not emitted in State
    "_vol_min": "-60",
    "_vol_max": "0",
    "_vol_enabled": "1",
    "_vol_adaptive": "0",
    "_metadata": "",  # optional <metadata> child injected into the Status frame
}


def _apply(name: str, attrs: dict[str, str], state: dict[str, str]) -> None:
    value = attrs.get("value", "")
    if name == "SetMode":
        state["mode"] = value
        state["rate"] = "0"  # mode resets rate to auto (protocol.md §6)
    elif name == "SetFilter":
        state["filterNx"] = value
        state["filter1x"] = attrs.get("value1x", value)
    elif name == "SetShaping":
        state["shaper"] = value
    elif name == "SetRate":
        state["rate"] = value
    elif name == "SetJunkFilter":
        state["filter_junk"] = value
    elif name == "SetAdaptiveVolume":
        state["adaptive"] = value
    elif name == "Volume":
        state["volume"] = value
    elif name == "MatrixSetProfile":
        state["matrix_profile"] = value  # live switch; State reports it back


def _query(name: str, state: dict[str, str]) -> str | None:
    """Read-only commands answered from state; None for setters."""
    if name == "GetInfo":
        return '<GetInfo name="Fake" engine="6.0.4" version="6"/>'
    if name == "GetLicense":
        return '<GetLicense valid="1" name="Fake Licensee" fingerprint="AAAA"/>'
    if name == "ConfigurationGet":
        return f'<ConfigurationGet result="OK" value="{state.get("_active_config", "")}"/>'
    if name == "MatrixListProfiles":
        items = "".join(f'<MatrixProfile name="{n}"/>' for n in ("Default", "Mch-to-Stereo mixdown"))
        return f'<MatrixListProfiles result="OK">{items}</MatrixListProfiles>'
    if name == "MatrixGetProfile":
        return f'<MatrixGetProfile result="OK" value="{state.get("_matrix_profile", "")}"/>'
    if name == "State":
        return "<State " + " ".join(f'{k}="{v}"' for k, v in state.items() if not k.startswith("_")) + "/>"
    if name == "VolumeRange":
        return (
            f'<VolumeRange min="{state["_vol_min"]}" max="{state["_vol_max"]}" '
            f'enabled="{state["_vol_enabled"]}" adaptive="{state["_vol_adaptive"]}"/>'
        )
    if name == "Status":
        # active_* live on the Status root; the track <metadata> child is where the
        # daemon emits unescaped chars mid-playback (_metadata override).
        return (
            f'<Status state="{state["state"]}" active_mode="PCM" '
            f'active_filter="poly-sinc-gauss-long" active_shaper="NS9" '
            f'active_rate="192000" volume="{state["volume"]}">'
            f'{state["_metadata"]}</Status>'
        )
    return None


def _handle(body: str, state: dict[str, str]) -> str:
    el = _fromstring(body)
    name, attrs = el.tag, el.attrib
    answer = _query(name, state)
    if answer is not None:
        return answer
    if name == "Volume" and state["_vol_enabled"] == "0":
        return '<Volume result="Error"/>'  # volume control disabled (protocol.md §7.3)
    value = attrs.get("value")
    if value == "err":
        return f'<{name} result="Error">bad value</{name}>'
    if value != "999":  # 999 = OK but not applied (readback-verify caveat)
        _apply(name, attrs, state)
    return f'<{name} result="OK"/>'


async def _serve(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    overrides: dict[str, str] | None = None,
) -> None:
    state = {**_DEFAULTS, **(overrides or {})}
    while True:
        data = await reader.read(4096)
        if not data:
            break
        body = data.split(b"?>", 1)[-1].strip().decode()
        writer.write(f"{XML}{_handle(body, state)}\n".encode())
        await writer.drain()


@pytest.fixture
async def live_daemon_port() -> AsyncIterator[int]:
    server = await asyncio.start_server(_serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    yield port
    server.close()
    await server.wait_closed()


@pytest.fixture
async def live_client(live_daemon_port: int) -> AsyncIterator[ControlClient]:
    client = ControlClient("127.0.0.1", live_daemon_port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()


@pytest.fixture
async def garbled_metadata_client() -> AsyncIterator[ControlClient]:
    """Daemon whose Status carries a track <metadata> child with unescaped chars
    — the real 6.0.4 quirk that hangs a strict receiver during playback. A bare
    '<' inside an attribute can't be repaired by the bare-'&' fix, so the root's
    active_* must be recovered by dropping the child (control.py _recover_root)."""
    bad = '<metadata artist="A&B" album="Foo <Bar> Baz"/>'
    serve = functools.partial(_serve, overrides={"_metadata": bad})
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


@pytest.fixture
async def disabled_volume_client() -> AsyncIterator[ControlClient]:
    """A fake daemon with volume control disabled (VolumeRange enabled=0), so a
    Volume write is rejected — the live-slider gray/error case."""
    serve = functools.partial(_serve, overrides={"_vol_enabled": "0"})
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


# --- fake HTTP config daemon (port 8088 lane), implemented in fake_http ---


@pytest.fixture
def http_daemon() -> Iterator[dict[str, Any]]:
    yield from fake_http.spawn(fake_http.state())


@pytest.fixture
def stale_http_daemon() -> Iterator[dict[str, Any]]:
    # serves the pre-restart archive for one backup read before catching up
    yield from fake_http.spawn(fake_http.state(_lag=1))


@pytest.fixture
def dying_http_daemon() -> Iterator[dict[str, Any]]:
    # accepts the restore, then goes unreachable and never returns
    yield from fake_http.spawn(fake_http.state(_die=True))
