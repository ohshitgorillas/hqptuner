"""One naming rule for both preset stores.

A preset name is three things at once: a filename in HQPTuner's own store
(``<name>.xml``), a member name in the ``POST /restore`` archive
(``data/cfgs/<name>.xml``), and a profile name the daemon lists back over the
Control API. None of the three constrain it to ASCII. hqplayerd round-trips em
dashes, accented Latin, CJK, non-BMP emoji, XML metacharacters and decomposed
Unicode byte-identically, and normalizes nothing (probed against 6.0.4,
``scripts/probes/probe_profile_name_charset.py``); no HQPlayer document states a
charset rule at all, and ``docs/protocol.md:66`` types the parameter as plain
text.

So the rule is a denylist of what genuinely breaks — path escapes, control
characters, and the filesystem's byte limit — not an allowlist of what happened
to be easy to spell. An allowlist here refused ``Headphones — ZMF Ori 3.0`` for
no reason the daemon or the filesystem cared about.
"""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hqptuner.errors import HQPTunerError

# ``<name>.xml`` has to fit one filesystem path component. Linux caps that at 255
# BYTES, not characters, so the limit is measured on the UTF-8 encoding — a
# 100-character CJK name is 300 bytes and does not fit. hqplayerd fails this case
# SILENTLY (HTTP 2xx, nothing written), so refusing it here is what turns a
# preset that vanished into an error the user can actually read.
_NAME_MAX = 255
_SUFFIX = ".xml"


def _escapes_the_store(name: str) -> bool:
    """Whether ``name`` could address anything but a file directly inside the store directory.

    That is: a path hop, a separator, or a dotfile.
    """
    return name.startswith(".") or "/" in name or "\\" in name or ".." in name


def _has_control_char(name: str) -> bool:
    """Whether ``name`` carries a control character.

    Category Cc is exactly the C0 controls, DEL and the C1 controls. Deliberately
    NOT ``str.isprintable()``, which also rejects category Cf — that would refuse
    the zero-width joiner, and so refuse multi-codepoint emoji the daemon handles
    perfectly well.
    """
    return any(unicodedata.category(char) == "Cc" for char in name)


def _too_long(name: str) -> bool:
    """Whether ``<name>.xml`` would overrun the filesystem's per-component limit."""
    return len(name.encode("utf-8")) + len(_SUFFIX) > _NAME_MAX


def _is_valid(name: str) -> bool:
    """Whether ``name`` is safe as a preset name.

    See the module docstring for why this is a denylist rather than an allowlist.
    """
    if not name or name != name.strip():
        return False
    return not (_escapes_the_store(name) or _has_control_char(name) or _too_long(name))


def sort_key(name: str) -> tuple[tuple[int, int, str], ...]:
    """Sort key putting embedded numbers in numeric order.

    Preset names are mostly settings written out ("DSD256", "PCM 8x"), and a plain string sort reads their digits
    left to right: "DSD1024" lands above "DSD256" because "1" precedes "2". Splitting on digit runs and comparing
    the runs as integers puts the list back in the order the names describe. Text between the runs still compares
    as text, case and all, so nothing but the numbers changes.
    """
    return tuple((1, int(part), "") if part.isdigit() else (0, 0, part) for part in re.split(r"(\d+)", name))


def validate_name(name: str, error: type[HQPTunerError], label: str) -> str:
    """``name`` back when it is a usable preset name, else ``error`` naming it.

    ``label`` distinguishes the two stores' messages ("preset" / "live preset");
    the rule itself is deliberately one rule, so a name that saves in one surface
    saves in the other.
    """
    if not _is_valid(name):
        raise error(f"invalid {label} name: {name!r}", code="name_invalid")
    return name
