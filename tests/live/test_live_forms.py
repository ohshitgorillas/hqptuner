"""Version canary: the live daemon still serves every form field the write path targets.

The persistent lane reaches hqplayerd by scraping its web UI forms and editing
config XML by field name. Both halves are pinned to what 6.0.4 happened to
serve — ``tests/fixtures/*-6.0.4.html`` are frozen captures — so a point release
that renames or drops a field leaves the entire offline suite green while the
write path silently loses a setting. Nothing else in the repo looks at the real
daemon, which is why this file exists.

Run after any hqplayerd upgrade: ``make test-live``.

Credentials come from ``HQPTUNER_HQP_USERNAME`` / ``HQPTUNER_HQP_PASSWORD`` in
the environment, like every other knob (``hqptuner/config.py``). Without them
``Config`` falls back to hqplayerd's stock management pair, the daemon answers
401, and these tests ERROR rather than skip — deliberately. Only an unanswered
socket is a skip; anything else would let a misconfigured canary read as green.

**Strictly read-only** — three GETs, no POST — per docs/testing.md's rule that
live tests never write against the production daemon.

The expected fields derive from ``presetconf``, never a hand-kept list. A canary
you have to remember to widen is one that quietly stops covering things: this
file's whole value is that it cannot fall behind the write path.
"""

import asyncio
from typing import Any

import httpx
import pytest

from hqptuner.conf import fixedvol, matrixconf, presetconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config

#: /matrix names its four global controls bare; presetconf prefixes them
#: ``matrix_*`` because /speakers has an ``enabled`` of its own. One field, two
#: namespaces — normalize to presetconf's before comparing.
MATRIX_GLOBALS = frozenset({"enabled", "engine", "expand_hf", "iir2fir"})

#: readme §1.9 — the daemon keeps eight channel slots regardless of speaker set
SPEAKER_CHANNELS = 8
SPEAKER_MEASURES = ("level", "distance")


def _catalog_fields() -> set[str]:
    """Every flat form field the persistent write path can target."""
    fields = (
        set(presetconf.FIELD_MAP)
        | set(matrixconf.PLUGIN_MAP)
        | {presetconf.NET_DEVICE, fixedvol.FIXED_ENABLED, fixedvol.FIXED_LEVEL}
    )
    # The pipeline table reaches the wire as indexed source_N / process_N /
    # gain_N rows, so it has no flat name to look for — its own shape is
    # covered by the matrix row parser's tests.
    return fields - {matrixconf.MATRIX_PIPELINES}


CATALOG_FIELDS = sorted(_catalog_fields())


async def _fetch() -> dict[str, Any]:
    cfg = Config()
    client = HttpConfigClient(cfg.hqp_host, cfg.hqp_http_port, cfg.hqp_username, cfg.hqp_password)
    try:
        return {
            "config": await client.get_config(),
            "matrix": await client.get_matrix(),
            "speakers": await client.get_speakers(),
        }
    finally:
        await client.aclose()


@pytest.fixture(scope="module")
def live_forms() -> dict[str, Any]:
    """The three real forms, fetched once.

    Skips only when nothing answers, so the suite stays green on a machine with
    no hqplayerd. A daemon that *does* answer and then refuses (401 on
    re-provisioned management credentials) or errors is a FAILURE, not a skip —
    swallowing that would turn a misconfigured canary into a silent green.
    """
    try:
        return asyncio.run(_fetch())
    except (httpx.ConnectError, httpx.ConnectTimeout, OSError) as exc:
        pytest.skip(f"no reachable hqplayerd: {exc}")


@pytest.fixture(scope="module")
def live_field_names(live_forms: dict[str, Any]) -> set[str]:
    """Flat field names across /config and /matrix, in presetconf's namespace."""
    names = {f["name"] for f in live_forms["config"]["fields"]}
    for field in live_forms["matrix"]["fields"]:
        name = field["name"]
        names.add(f"matrix_{name}" if name in MATRIX_GLOBALS else name)
    return names


@pytest.mark.live
@pytest.mark.parametrize("field", CATALOG_FIELDS, ids=str)
def test_live_form_still_carries_the_field(field: str, live_field_names: set[str]) -> None:
    assert field in live_field_names


@pytest.mark.live
@pytest.mark.parametrize("measure", SPEAKER_MEASURES, ids=str)
def test_every_speaker_channel_still_carries_the_measure(measure: str, live_forms: dict[str, Any]) -> None:
    channels = live_forms["speakers"]["channels"]
    assert sum(measure in channel for channel in channels) == SPEAKER_CHANNELS
