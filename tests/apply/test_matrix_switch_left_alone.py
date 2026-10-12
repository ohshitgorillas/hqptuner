"""Staging a post-process plugin does not touch the matrix switch.

``<post_process>`` nests inside ``<matrix>`` (hqplayerd-readme.txt §1.11.2) and
§1.11's ``enabled`` is the matrix processing switch, so a bypassed matrix runs no
plugin at all. That makes the switch tempting to flip on the user's behalf when a
plugin is turned on — and wrong to: the matrix carries the whole pipeline, so
engaging it changes what the daemon does with every channel, not just the plugin
the user asked for. The switch is its own setting, moved only when it is staged.
"""

from typing import Any

import pytest

from hqptuner.core.manager import ConnectionManager

#: Every plugin the chain carries, one per ``<plugin type=…>`` tag 6.0.4 writes
#: inside ``<post_process>`` (readme §1.11.2), in the order they appear there.
#: The switch is one attribute on one of three sibling tags, so a writer that
#: locates the wrong sibling — or only ever the last one — reads correct against
#: a single-plugin sweep.
PLUGIN_SWITCHES = ["post_correction_enabled", "post_bauer_enabled", "post_loudness_enabled"]


# --- through a whole apply ------------------------------------------------------


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
@pytest.mark.parametrize("engaged", [False, True], ids=["bypassed", "engaged"])
async def test_an_apply_that_enables_a_plugin_leaves_the_daemons_matrix_switch_as_it_was(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], plugin: str, *, engaged: bool
) -> None:
    # the switch is not merely left at some fixed value, it is left where the
    # daemon had it. A lane that ignored the key entirely could satisfy only
    # one side of this.
    http_daemon["matrix_enabled"] = engaged
    http_daemon[plugin] = False
    await http_manager.applyops.apply({}, {plugin: "1"})
    assert http_daemon["matrix_enabled"] is engaged


@pytest.mark.parametrize("plugin", PLUGIN_SWITCHES)
async def test_an_apply_that_enables_a_plugin_under_a_bypassed_matrix_lands_the_plugin(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], plugin: str
) -> None:
    http_daemon["matrix_enabled"] = False
    http_daemon[plugin] = False
    await http_manager.applyops.apply({}, {plugin: "1"})
    assert http_daemon[plugin] is True
