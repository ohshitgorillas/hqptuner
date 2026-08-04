"""Staging a post-process plugin does not touch the matrix switch.

``<post_process>`` nests inside ``<matrix>`` (hqplayerd-readme.txt §1.11.2) and
§1.11's ``enabled`` is the matrix processing switch, so a bypassed matrix runs no
plugin at all. That makes the switch tempting to flip on the user's behalf when a
plugin is turned on — and wrong to: the matrix carries the whole pipeline, so
engaging it changes what the daemon does with every channel, not just the plugin
the user asked for. The switch is its own setting, moved only when it is staged.

The absent-element case is a distinct one. hqplayerd writes only the elements it
has had reason to write and fills none of them back in on load, so a config with
no ``<matrix>`` is the ordinary state of one whose owner has never used matrix
processing — and an absent ``enabled`` is the daemon's own default, not ``0``.
Writing either value there would assert a switch position nobody chose.

Snapshots are rendered by the fake daemon's own 6.0.4-shaped config renderer, so
the writer is exercised against documents authored independently of it.
"""

from typing import Any

import pytest
from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.conf import presetconf
from hqptuner.core.manager import ConnectionManager

#: Nothing but a bare root: the config of a user who has never had matrix
#: processing, so the element the switch lives on has never been written.
BARE = b"<hqplayerd/>"

MATRIX_SWITCH = "matrix_enabled"
PLUGIN_SWITCH = "post_loudness_enabled"

#: Every plugin the chain carries, one per ``<plugin type=…>`` tag 6.0.4 writes
#: inside ``<post_process>`` (readme §1.11.2), in the order they appear there.
#: The switch is one attribute on one of three sibling tags, so a writer that
#: locates the wrong sibling — or only ever the last one — reads correct against
#: a single-plugin sweep.
PLUGIN_SWITCHES = ["post_correction_enabled", "post_bauer_enabled", "post_loudness_enabled"]


def cfg(**overrides: Any) -> bytes:
    return cfg_xml(state(**overrides))


def switch_after(xml: bytes, edits: dict[str, str]) -> str | None:
    """The matrix switch as a caller reads it back after staging ``edits``."""
    return presetconf.read_config(presetconf.apply_edits(xml, edits)).get(MATRIX_SWITCH)


# --- a plugin switched on leaves the carrier alone -----------------------------


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
def test_enabling_a_plugin_leaves_a_bypassed_matrix_bypassed(plugin: str) -> None:
    assert switch_after(cfg(matrix_enabled=False), {plugin: "1"}) == "0"


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
def test_enabling_a_plugin_under_a_bypassed_matrix_still_lands_the_plugin_switch(plugin: str) -> None:
    edited = presetconf.apply_edits(cfg(matrix_enabled=False, **{plugin: False}), {plugin: "1"})
    assert presetconf.read_config(edited)[plugin] == "1"


def test_enabling_a_plugin_asserts_no_matrix_switch_on_a_config_with_no_matrix() -> None:
    # an absent attribute is the daemon's own default; writing either value here
    # would pick a switch position on the user's behalf
    assert MATRIX_SWITCH not in presetconf.read_config(presetconf.apply_edits(BARE, {PLUGIN_SWITCH: "1"}))


def test_enabling_a_plugin_leaves_an_engaged_matrix_engaged() -> None:
    assert switch_after(cfg(matrix_enabled=True), {PLUGIN_SWITCH: "1"}) == "1"


# --- the switch moves when, and only when, it is staged -------------------------


def test_a_staged_matrix_switch_of_one_lands_engaged_alongside_a_plugin_enable() -> None:
    edits = {PLUGIN_SWITCH: "1", MATRIX_SWITCH: "1"}
    assert switch_after(cfg(matrix_enabled=False), edits) == "1"


def test_a_staged_matrix_switch_of_zero_lands_bypassed_alongside_a_plugin_enable() -> None:
    edits = {PLUGIN_SWITCH: "1", MATRIX_SWITCH: "0"}
    assert switch_after(cfg(matrix_enabled=True), edits) == "0"


# --- a plugin switched off leaves the carrier alone too -------------------------


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
def test_disabling_a_plugin_leaves_an_engaged_matrix_engaged(plugin: str) -> None:
    assert switch_after(cfg(matrix_enabled=True, **{plugin: True}), {plugin: "0"}) == "1"


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
def test_disabling_a_plugin_leaves_a_bypassed_matrix_bypassed(plugin: str) -> None:
    assert switch_after(cfg(matrix_enabled=False, **{plugin: True}), {plugin: "0"}) == "0"


def test_disabling_a_plugin_asserts_no_matrix_switch_on_a_config_with_no_matrix() -> None:
    assert MATRIX_SWITCH not in presetconf.read_config(presetconf.apply_edits(BARE, {PLUGIN_SWITCH: "0"}))


# --- through a whole apply ------------------------------------------------------


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
async def test_an_apply_that_enables_a_plugin_leaves_the_daemons_matrix_bypassed(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], plugin: str
) -> None:
    http_daemon["matrix_enabled"] = False
    http_daemon[plugin] = False
    await http_manager.applyops.apply({}, {plugin: "1"})
    assert http_daemon["matrix_enabled"] is False


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
async def test_an_apply_that_enables_a_plugin_leaves_the_daemons_engaged_matrix_engaged(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], plugin: str
) -> None:
    # the companion of the bypassed case above: the switch is not merely left at
    # some fixed value, it is left where the daemon had it. A lane that ignored
    # the key entirely could satisfy one of the pair, never both.
    http_daemon["matrix_enabled"] = True
    http_daemon[plugin] = False
    await http_manager.applyops.apply({}, {plugin: "1"})
    assert http_daemon["matrix_enabled"] is True


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
async def test_an_apply_that_enables_a_plugin_under_a_bypassed_matrix_lands_the_plugin(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], plugin: str
) -> None:
    http_daemon["matrix_enabled"] = False
    http_daemon[plugin] = False
    await http_manager.applyops.apply({}, {plugin: "1"})
    assert http_daemon[plugin] is True
