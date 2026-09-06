"""One naming rule for both preset stores, plus one more for a name's first save.

A preset name is three things at once: a filename in HQPTuner's own store
(``<name>.xml``), a member name in the ``POST /restore`` archive
(``data/cfgs/<name>.xml``), and a profile name the daemon lists back over the
Control API. None of the three constrain it to ASCII. hqplayerd round-trips em
dashes, accented Latin, CJK, non-BMP emoji, XML metacharacters and decomposed
Unicode byte-identically, and normalizes nothing (probed against 6.0.4,
``scripts/probes/probe_profile_name_charset.py``); no HQPlayer document states a
charset rule at all, and ``docs/protocol.md:66`` types the parameter as plain
text.

So the shared rule is a denylist of what breaks a filename, a zip member name or
the store: path escapes, control characters, the filesystem's byte limit, an
empty name, leading whitespace. Trailing whitespace is trimmed rather than
refused. An allowlist here refused ``Headphones — ZMF Ori 3.0`` for no reason
the daemon or the filesystem cared about.

The one exception to "refuse only what breaks" is ``validate_new_name``: a name
entering a store for the first time is also refused when its letters mix the
Latin and Cyrillic scripts, because ``admin`` spelled with U+0430 CYRILLIC
SMALL LETTER A renders identically to ``admin`` beside it. That check runs on a
first save only, so a name an older build already stored keeps reading,
applying, overwriting and deleting. Greek is deliberately outside the check
(``ΔΣ 256`` is an ordinary audio name), and a whole-script lookalike (``pay``
spelled entirely in Cyrillic) is out of its reach: the standard library carries
no confusables table.

Every refusal reads ``Invalid <label> name: <reason>`` with the reason in the
owner's words, one per check, under the one code ``name_invalid``.
"""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

    from hqptuner.errors import HQPTunerError

# ``<name>.xml`` has to fit one filesystem path component. Linux caps that at 255
# BYTES, not characters, so the limit is measured on the UTF-8 encoding — a
# 100-character CJK name is 300 bytes and does not fit. hqplayerd fails this case
# SILENTLY (HTTP 2xx, nothing written), so refusing it here is what turns a
# preset that vanished into an error the user can actually read.
_NAME_MAX = 255
_SUFFIX = ".xml"

# The scripts whose letters look alike often enough to be worth refusing a mix
# of. Read off the first word of a character's Unicode name, which for letters
# is the script ("LATIN SMALL LETTER A", "CYRILLIC SMALL LETTER A"); symbols
# such as MICRO SIGN start with something else and count for nothing.
_CONFUSABLE_SCRIPTS = frozenset({"LATIN", "CYRILLIC"})

_MIXED_SCRIPTS = "mixing Latin and Cyrillic characters is forbidden."


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


# The shared rule, in the order the checks run on an already right-stripped
# name. Each entry pairs the check with the reason the refusal states; the
# reasons are owner copy, verbatim.
_CHECKS: tuple[tuple[Callable[[str], bool], str], ...] = (
    (lambda name: not name, "empty."),
    (lambda name: name[0].isspace(), "leading whitespace."),
    (lambda name: name.startswith("."), "leading period."),
    (lambda name: "/" in name or "\\" in name, "contains path separator."),
    (lambda name: ".." in name, "double dots."),
    (_has_control_char, "invalid (control) character."),
    (_too_long, "too long."),
)


def _reason_refused(name: str) -> str | None:
    """Return the reason the shared rule refuses ``name``, or None when it is a usable preset name."""
    return next((reason for check, reason in _CHECKS if check(name)), None)


def _script_of(char: str) -> str | None:
    """Which confusable script ``char`` is a letter of, or None for anything else."""
    if not unicodedata.category(char).startswith("L"):
        return None
    word = unicodedata.name(char, "").split(" ", 1)[0]
    return word if word in _CONFUSABLE_SCRIPTS else None


def _mixes_confusable_scripts(name: str) -> bool:
    """Whether ``name`` draws letters from more than one of the confusable scripts."""
    return len({script for script in map(_script_of, name) if script is not None}) > 1


def sort_key(name: str) -> tuple[tuple[int, int, str], ...]:
    """Sort key putting embedded numbers in numeric order.

    Preset names are mostly settings written out ("DSD256", "PCM 8x"), and a plain string sort reads their digits
    left to right: "DSD1024" lands above "DSD256" because "1" precedes "2". Splitting on digit runs and comparing
    the runs as integers puts the list back in the order the names describe. Text between the runs still compares
    as text, case and all, so nothing but the numbers changes.
    """
    return tuple((1, int(part), "") if part.isdigit() else (0, 0, part) for part in re.split(r"(\d+)", name))


def validate_name(name: str, error: type[HQPTunerError], label: str) -> str:
    """``name`` with trailing whitespace removed when it is a usable preset name, else ``error`` saying why.

    ``label`` distinguishes the stores' messages ("preset" / "snapshot"); the
    rule itself is one rule, so a name that saves in one surface saves in the
    other. Callers key on the returned value, never the argument: the two differ
    exactly when the argument carried trailing whitespace.
    """
    name = name.rstrip()
    reason = _reason_refused(name)
    if reason is not None:
        raise error(f"Invalid {label} name: {reason}", code="name_invalid")
    return name


def validate_new_name(name: str, error: type[HQPTunerError], label: str) -> str:
    """``validate_name`` plus the first-save check: a mix of Latin and Cyrillic letters is refused.

    For a name entering a store for the first time only. A stored name that
    would fail this is still read, overwritten and deleted through
    ``validate_name``, so nothing an older build saved is stranded.
    """
    name = validate_name(name, error, label)
    if _mixes_confusable_scripts(name):
        raise error(f"Invalid {label} name: {_MIXED_SCRIPTS}", code="name_invalid")
    return name
