"""The layer order holds at runtime, not just at import time.

``api > core > presets > lanes > engine > conf`` (architecture §11.1) is gated by
``lint-imports``, which sees imports only. A lower layer can still reach upward
without importing anything: handed the manager, it reads ``manager.<attr>`` and
gets an object built in a layer above it. That read is the inversion the import
contract cannot see, and these cases look for it.

Which manager attributes count is not written down here. A manager is built the
way the suite builds one, and every attribute it holds is classed by the layer
its value's type is defined in (``hqptuner.<layer>.…``). A module under a lower
layer then may not read any attribute so classed, whether as ``x.<attr>`` or as
``getattr(x, "<attr>")``. What the module needs from above is handed in by its
caller as an argument instead.
"""

import ast
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from virtual_clock import VirtualClock

import hqptuner
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

#: The package root every layer directory sits under.
PACKAGE_ROOT = Path(hqptuner.__file__).resolve().parent

#: Every layer directory, top to bottom.
LAYERS = ("api", "core", "presets", "lanes", "engine", "conf")

#: Layers allowed to read a preset-store object off the manager: presets and above.
AT_OR_ABOVE_PRESETS = LAYERS[: LAYERS.index("presets") + 1]

#: Layers allowed to read connection state off the manager: every layer but the bottom one.
ABOVE_CONF = LAYERS[: LAYERS.index("conf")]


@pytest.fixture
async def manager(tmp_path: Path) -> AsyncIterator[ConnectionManager]:
    """A manager as the suite builds one, never started: only its attributes are read."""
    built = ConnectionManager(
        Config(
            hqp_host="127.0.0.1",
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        ),
        clock=VirtualClock(),
    )
    yield built
    await built.aclose()


def attributes_from_layer(manager: ConnectionManager, layer: str) -> frozenset[str]:
    """Names of the manager's attributes whose value's type is defined under ``hqptuner.<layer>``."""
    prefix = f"hqptuner.{layer}"
    return frozenset(
        name
        for name, value in vars(manager).items()
        if type(value).__module__ == prefix or type(value).__module__.startswith(prefix + ".")
    )


def _attribute_read(node: ast.AST) -> str | None:
    """The attribute name ``node`` reads, as ``x.name`` or ``getattr(x, "name", ...)``."""
    if isinstance(node, ast.Attribute):
        return node.attr
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "getattr"
        and len(node.args) >= 2
        and isinstance(node.args[1], ast.Constant)
        and isinstance(node.args[1].value, str)
    ):
        return node.args[1].value
    return None


def reads_of(names: frozenset[str], layers: tuple[str, ...]) -> list[str]:
    """Every read of one of ``names`` in a module under ``layers``, as ``path:line attr``, sorted."""
    sites: list[str] = []
    for layer in layers:
        for path in (PACKAGE_ROOT / layer).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                attr = _attribute_read(node)
                if attr in names:
                    sites.append(f"{path.relative_to(PACKAGE_ROOT)}:{getattr(node, 'lineno', 0)} {attr}")
    return sorted(sites)


def test_every_read_of_a_preset_store_object_off_the_manager_sits_at_or_above_presets(
    manager: ConnectionManager,
) -> None:
    held = attributes_from_layer(manager, "presets")
    assert reads_of(held, LAYERS) == reads_of(held, AT_OR_ABOVE_PRESETS)


def test_every_read_of_connection_state_off_the_manager_sits_above_conf(
    manager: ConnectionManager,
) -> None:
    held = attributes_from_layer(manager, "core")
    assert reads_of(held, LAYERS) == reads_of(held, ABOVE_CONF)
