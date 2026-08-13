"""The gate that refuses re-export modules and trivial forwarders.

``scripts/gates/check_no_barrels.py`` takes file paths on argv and parses each
with ``ast``. Two shapes fail. A module whose body imports things and defines
nothing is a barrel: it adds a name to import through and no behaviour, so it
buys indirection with nothing. A function whose whole body is ``return
<name>.<attr>(<its own parameters>)`` is a forwarder: the caller could have
called the thing itself, and the layer it appears to add is a name change. The
chain root is any name — ``self``, a parameter, or a module imported at the top
of the file — and when the root is the function's own first parameter that
parameter drops out of the argument list the call has to match.

``__init__.py`` is never a barrel: presenting a package's surface is what the
file is for, and it needs no permission slip to do it. Everything else that is
there on purpose says why in one of two mappings — ``FORWARDER_EXEMPT``, keyed
``path::function_name``, and ``MODULE_EXEMPT``, keyed by module path. Both are
audited against the filesystem rather than against the paths handed over, so a
partial commit that touches one file is not told every other entry is stale,
and an entry that has stopped being true cannot hide by staying out of the run.

The forwarder rule is scoped: it applies under ``hqptuner/core/``,
``hqptuner/lanes/``, ``hqptuner/presets/``, ``hqptuner/engine/`` and
``hqptuner/conf/``. ``hqptuner/api/`` is exempt by design, because a route
handler forwarding to a core call is the shape that layer is for. The barrel
rule applies everywhere.

Each case writes real source into ``tmp_path``, changes into it so the paths
handed to the gate are repo-relative the way the Makefile passes them, and
injects both its own exemption mappings. Observable contract is the pair the
script offers a caller: the int exit code, and what lands on stdout. Nothing
here reads the gate's internals.

The seam is ``check(paths, exempt=None, module_exempt=None) -> int``.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_no_barrels.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_no_barrels_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check


#: A class whose one method forwards straight through to a collaborator, with
#: a docstring in front of the return.
FORWARDER = '''
class Tuner:
    """A thing that owns a client."""

    def set_volume(self, level, ramp):
        """Set the volume."""
        return self.client.set_volume(level, ramp)
'''

#: The same forwarder written without the docstring: a bare single return.
BARE_FORWARDER = """
class Tuner:
    def set_volume(self, level, ramp):
        return self.client.set_volume(level, ramp)
"""

#: The same shape awaited.
ASYNC_FORWARDER = """
class Tuner:
    async def set_volume(self, level, ramp):
        return await self.client.set_volume(level, ramp)
"""

#: A free function forwarding through one of its own parameters, which drops
#: out of the argument list the call must match.
PARAMETER_ROOTED_FORWARDER = """
def set_volume(client, level, ramp):
    return client.set_volume(level, ramp)
"""

#: A method forwarding through a module imported at the top of the file. The
#: root is not a parameter, so the call carries the full parameter list.
MODULE_ROOTED_FORWARDER = """
from hqptuner.presets import presetlane


class Presets:
    async def read_preset(self, name):
        return await presetlane.read(self, name)
"""

#: A forwarder whose call rearranges the parameters, so the wrapper does work.
REORDERED = """
class Tuner:
    def set_volume(self, level, ramp):
        return self.client.set_volume(ramp, level)
"""

#: A method that does something before handing on, so it is not a pass-through.
GUARDED = '''
class Tuner:
    def set_volume(self, level, ramp):
        """Set the volume."""
        level = max(level, 0)
        return self.client.set_volume(level, ramp)
'''

#: Imports and nothing else: the barrel shape.
BARREL = """
from hqptuner.core.tuner import Tuner
from hqptuner.core.volume import ramp
"""

#: Imports and a re-export manifest, which is the barrel declaring itself.
BARREL_WITH_ALL = """
from hqptuner.core.tuner import Tuner
from hqptuner.core.volume import ramp

__all__ = ["Tuner", "ramp"]
"""

#: Imports plus module-level constants, which are something the module defines.
IMPORTS_AND_CONSTANTS = """
import enum

DEFAULT_RATE = 44100
SUPPORTED_RATES = (44100, 48000, 96000)
RATE_KIND = enum.IntEnum("RATE_KIND", ["pcm", "sdm"])
"""

#: Imports plus a function, which is a module that does something.
IMPORTS_AND_A_FUNCTION = """
import math


def area(r):
    return math.pi * r * r
"""

#: Imports plus a class, which is a module that does something.
IMPORTS_AND_A_CLASS = """
import json


class Codec:
    def dumps(self, value):
        payload = dict(value)
        return json.dumps(payload, sort_keys=True)
"""


def write_source(tmp_path: Path, relpath: str, source: str) -> str:
    """Write ``source`` at ``relpath`` under ``tmp_path``; return the relative path."""
    path = tmp_path / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return relpath


# --- rule 1: re-export modules -------------------------------------------------


def test_a_module_defining_a_class_passes_however_many_imports_it_has(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/codec.py", IMPORTS_AND_A_CLASS)
    assert CHECK([path], {}, {}) == 0


def test_a_module_defining_only_a_function_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/util.py", IMPORTS_AND_A_FUNCTION)
    assert CHECK([path], {}, {}) == 0


def test_a_module_of_imports_and_constants_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """A constant is something the module defines, so the file is not pure indirection."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/rates.py", IMPORTS_AND_CONSTANTS)
    assert CHECK([path], {}, {}) == 0


def test_a_module_of_imports_defining_nothing_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/facade.py", BARREL)
    assert CHECK([path], {}, {}) == 1


def test_a_module_of_imports_defining_nothing_is_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/facade.py", BARREL)
    CHECK([path], {}, {})
    assert "hqptuner/core/facade.py" in capsys.readouterr().out


def test_a_module_of_imports_and_only_an_all_manifest_fails(tmp_path: Path, monkeypatch: Any) -> None:
    """``__all__`` is the re-export's own inventory, not something the module defines."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/facade.py", BARREL_WITH_ALL)
    assert CHECK([path], {}, {}) == 1


def test_an_empty_module_with_no_imports_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """Nothing to re-export is not a barrel."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/placeholder.py", "")
    assert CHECK([path], {}, {}) == 0


def test_the_barrel_rule_applies_to_a_module_under_the_api_layer(tmp_path: Path, monkeypatch: Any) -> None:
    """Only the forwarder rule exempts ``hqptuner/api/``; a barrel there is still a barrel."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/api/facade.py", BARREL)
    assert CHECK([path], {}, {}) == 1


def test_a_package_init_of_pure_imports_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """Presenting a package's surface is what ``__init__.py`` is for, no permission slip needed."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/__init__.py", BARREL)
    assert CHECK([path], {}, {}) == 0


def test_a_package_init_of_imports_and_an_all_manifest_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/__init__.py", BARREL_WITH_ALL)
    assert CHECK([path], {}, {}) == 0


# --- rule 2: trivial forwarders ------------------------------------------------


def test_a_method_returning_a_call_on_self_with_its_own_parameters_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", FORWARDER)
    assert CHECK([path], {}, {}) == 1


def test_a_forwarder_is_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", FORWARDER)
    CHECK([path], {}, {})
    assert "set_volume" in capsys.readouterr().out


def test_a_forwarder_with_no_docstring_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", BARE_FORWARDER)
    assert CHECK([path], {}, {}) == 1


def test_an_awaited_forwarder_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/lanes/tuner.py", ASYNC_FORWARDER)
    assert CHECK([path], {}, {}) == 1


def test_a_forwarder_rooted_at_one_of_its_own_parameters_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/engine/volume.py", PARAMETER_ROOTED_FORWARDER)
    assert CHECK([path], {}, {}) == 1


def test_a_forwarder_rooted_at_an_imported_module_fails(tmp_path: Path, monkeypatch: Any) -> None:
    """The root is any name: ``presetlane.read(self, name)`` is the same barrel with a module in front."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/presets.py", MODULE_ROOTED_FORWARDER)
    assert CHECK([path], {}, {}) == 1


def test_a_module_rooted_forwarder_is_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/presets.py", MODULE_ROOTED_FORWARDER)
    CHECK([path], {}, {})
    assert "read_preset" in capsys.readouterr().out


def test_a_pass_through_whose_call_reorders_the_parameters_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """A different argument list is work the wrapper is doing, not a rename."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", REORDERED)
    assert CHECK([path], {}, {}) == 0


def test_a_method_doing_anything_before_the_return_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", GUARDED)
    assert CHECK([path], {}, {}) == 0


def test_a_forwarder_under_the_api_layer_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """A route handler forwarding into core is the shape that layer exists for."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/api/routes.py", FORWARDER)
    assert CHECK([path], {}, {}) == 0


def test_a_forwarder_outside_the_scoped_layers_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """The rule names five packages; a script beside them is not one of them."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "scripts/probes/probe_volume.py", FORWARDER)
    assert CHECK([path], {}, {}) == 0


@pytest.mark.parametrize("layer", ["core", "lanes", "presets", "engine", "conf"])
def test_the_forwarder_rule_applies_in_every_scoped_layer(tmp_path: Path, monkeypatch: Any, layer: str) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, f"hqptuner/{layer}/tuner.py", FORWARDER)
    assert CHECK([path], {}, {}) == 1


# --- FORWARDER_EXEMPT ----------------------------------------------------------


def test_an_exempt_forwarder_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", FORWARDER)
    assert CHECK([path], {f"{path}::set_volume": "the protocol interface requires this name"}, {}) == 0


def test_an_exempt_forwarder_is_not_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    """An exemption is silent — it excuses the forwarder rather than warning about it."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", FORWARDER)
    CHECK([path], {f"{path}::set_volume": "the protocol interface requires this name"}, {})
    assert "set_volume" not in capsys.readouterr().out


def test_an_exemption_excuses_only_the_function_it_names(tmp_path: Path, monkeypatch: Any) -> None:
    source = '''
class Tuner:
    def set_volume(self, level, ramp):
        """Set the volume."""
        return self.client.set_volume(level, ramp)

    def set_balance(self, offset):
        """Set the balance."""
        return self.client.set_balance(offset)
'''
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", source)
    assert CHECK([path], {f"{path}::set_volume": "the protocol interface requires this name"}, {}) == 1


def test_a_forwarder_exemption_whose_file_is_not_on_disk_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", GUARDED)
    assert CHECK([path], {"hqptuner/core/deleted.py::set_volume": "excused for a forgotten reason"}, {}) == 1


def test_a_forwarder_exemption_whose_file_is_not_on_disk_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", GUARDED)
    CHECK([path], {"hqptuner/core/deleted.py::set_volume": "excused for a forgotten reason"}, {})
    assert "hqptuner/core/deleted.py" in capsys.readouterr().out


def test_a_forwarder_exemption_naming_no_such_forwarder_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", FORWARDER)
    exempt = {
        f"{path}::set_volume": "the protocol interface requires this name",
        f"{path}::set_balance": "excused for a reason nobody remembers",
    }
    assert CHECK([path], exempt, {}) == 1


def test_a_forwarder_exemption_naming_no_such_forwarder_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/tuner.py", FORWARDER)
    exempt = {
        f"{path}::set_volume": "the protocol interface requires this name",
        f"{path}::set_balance": "excused for a reason nobody remembers",
    }
    CHECK([path], exempt, {})
    assert "set_balance" in capsys.readouterr().out


def test_a_stale_forwarder_exemption_for_a_file_not_passed_on_argv_still_fails(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """Staleness is judged against the filesystem, so which subset was handed over does not hide it."""
    monkeypatch.chdir(tmp_path)
    untouched = write_source(tmp_path, "hqptuner/core/untouched.py", GUARDED)
    committed = write_source(tmp_path, "hqptuner/core/committed.py", IMPORTS_AND_A_CLASS)
    assert CHECK([committed], {f"{untouched}::set_volume": "excused long ago"}, {}) == 1


def test_a_live_forwarder_exemption_for_a_file_not_passed_on_argv_passes(tmp_path: Path, monkeypatch: Any) -> None:
    """A partial commit reads the untouched file from disk and finds its entry still true."""
    monkeypatch.chdir(tmp_path)
    untouched = write_source(tmp_path, "hqptuner/core/untouched.py", FORWARDER)
    committed = write_source(tmp_path, "hqptuner/core/committed.py", IMPORTS_AND_A_CLASS)
    assert CHECK([committed], {f"{untouched}::set_volume": "the protocol interface requires this name"}, {}) == 0


# --- MODULE_EXEMPT -------------------------------------------------------------


def test_an_exempt_re_export_module_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/facade.py", BARREL)
    assert CHECK([path], {}, {path: "the public import path third parties already use"}) == 0


def test_an_exempt_re_export_module_is_not_named_on_stdout(tmp_path: Path, monkeypatch: Any, capsys: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/facade.py", BARREL)
    CHECK([path], {}, {path: "the public import path third parties already use"})
    assert "hqptuner/core/facade.py" not in capsys.readouterr().out


def test_a_module_exemption_whose_path_is_not_on_disk_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/codec.py", IMPORTS_AND_A_CLASS)
    assert CHECK([path], {}, {"hqptuner/core/deleted.py": "excused for a forgotten reason"}) == 1


def test_a_module_exemption_whose_path_is_not_on_disk_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/codec.py", IMPORTS_AND_A_CLASS)
    CHECK([path], {}, {"hqptuner/core/deleted.py": "excused for a forgotten reason"})
    assert "hqptuner/core/deleted.py" in capsys.readouterr().out


def test_a_module_exemption_naming_a_module_that_defines_something_fails_as_stale(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """Once the module has behaviour in it the excuse has nothing left to excuse."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/codec.py", IMPORTS_AND_A_CLASS)
    assert CHECK([path], {}, {path: "the public import path third parties already use"}) == 1


def test_a_module_exemption_naming_a_package_init_fails_as_stale(tmp_path: Path, monkeypatch: Any) -> None:
    """``__init__.py`` is never subject to the rule, so an entry for one excuses nothing."""
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/__init__.py", BARREL)
    assert CHECK([path], {}, {path: "the package surface"}) == 1


def test_a_module_exemption_naming_a_package_init_is_named_on_stdout(
    tmp_path: Path, monkeypatch: Any, capsys: Any
) -> None:
    monkeypatch.chdir(tmp_path)
    path = write_source(tmp_path, "hqptuner/core/__init__.py", BARREL)
    CHECK([path], {}, {path: "the package surface"})
    assert "hqptuner/core/__init__.py" in capsys.readouterr().out


def test_a_stale_module_exemption_for_a_file_not_passed_on_argv_still_fails(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    untouched = write_source(tmp_path, "hqptuner/core/untouched.py", IMPORTS_AND_A_CLASS)
    committed = write_source(tmp_path, "hqptuner/core/committed.py", IMPORTS_AND_A_FUNCTION)
    assert CHECK([committed], {}, {untouched: "excused long ago"}) == 1


def test_a_live_module_exemption_for_a_file_not_passed_on_argv_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    untouched = write_source(tmp_path, "hqptuner/core/untouched.py", BARREL)
    committed = write_source(tmp_path, "hqptuner/core/committed.py", IMPORTS_AND_A_FUNCTION)
    assert CHECK([committed], {}, {untouched: "the public import path third parties already use"}) == 0


# --- whole-tree ----------------------------------------------------------------


def test_a_tree_with_neither_shape_passes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.chdir(tmp_path)
    paths = [
        write_source(tmp_path, "hqptuner/core/codec.py", IMPORTS_AND_A_CLASS),
        write_source(tmp_path, "hqptuner/core/guarded.py", GUARDED),
        write_source(tmp_path, "hqptuner/core/rates.py", IMPORTS_AND_CONSTANTS),
        write_source(tmp_path, "hqptuner/core/__init__.py", BARREL),
    ]
    assert CHECK(paths, {}, {}) == 0
