#!/usr/bin/env python3
"""Gate: a staged edit is marked on every control kind, and marked where it shows.

One rule for all of them — an inset ring on the ``.field`` row (``fields.css``)
— cannot hold: an inset box-shadow paints on the element's own background
layer, strictly below its descendants, so the ring is only visible where the
control does NOT cover the row. That holds for a checkbox and a dropdown and
fails for the hero MODE and BACKEND segments, where ``hero.css`` strips the
field to ``padding: 0`` and stretches it to the hero row's height: the
segment's opaque buttons paint over three of the ring's four edges, and what is
left reads as an accent loop diving behind the switch and re-emerging as an
empty trough beneath it. Every gate stays green — the rule is fully tokenised
and names a real colour role; only a screenshot shows it.

So the marking is split by what the control can carry, and this gate holds the
split:

- a control with a border of its own recolours THAT border (``border-color:
  var(--accent)``) — a border belongs to the element it marks and cannot be
  overpainted by anything inside it;
- a control with no border to recolour keeps the row ring — a checkbox already
  paints its border accent when checked, so recolouring says nothing about
  staging, and knob and slidernum are canvas/range primitives with no border at
  all. The ring is honest for all three because their control never fills its
  row.

Three failures are reported. A widget kind in ``schema.js`` that appears in
neither table has no staged marking decision at all, which is how a new control
ships with no highlight. A widget in a table whose rule is missing from the
stylesheets is the same defect one step later. And an inset accent ring on a
``.dirty`` selector that is not scoped to one of the ring widgets is the
original bug being reintroduced wholesale.

Escape hatch: ``/* dirty-mark-exempt: <reason> */`` inside the block or on the
line above it, same contract as the token, class and card gates — the reason is
required.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from check_control_catalog import load_schema
from check_css_cards import rule_blocks

PRAGMA = "dirty-mark-exempt:"
ROOT = Path(__file__).resolve().parent.parent.parent
STYLESHEETS = ROOT / "hqptuner" / "static" / "css"
#: where the split itself is written, so a complaint points at the rules
DEFINITION_SITE = "hqptuner/static/css/fields.css"

#: widget kind -> the selector for the control's own border. The class the row
#: carries is `field-<widget>` (components/Field.js), so a rule may scope by
#: either that or the control primitive; what the gate requires is the primitive,
#: because the border being recoloured is the primitive's.
BORDER_WIDGETS = {
    "segment": ".segment",
    "dropdown": "select",
    "number": 'input[type="number"]',
    "text": 'input[type="text"]',
}
#: widget kinds with no border of their own — the row ring is theirs, and theirs
#: alone. Adding to this set is a claim that the control cannot cover its row.
RING_WIDGETS = ("checkbox", "knob", "slidernum")

BORDER_ACCENT = re.compile(r"^border(?:-color)?\s*:.*var\(\s*--accent\s*\)")
#: `inset` may sit before or after the colour, so match the property and then
#: require both tokens rather than pinning an order the syntax does not fix
BOX_SHADOW = re.compile(r"^box-shadow\s*:")
EXEMPT = re.compile(re.escape(PRAGMA) + r"\s*(?!\*/)\S")

Block = tuple[str, int, int, list[str]]


def stylesheets() -> list[Path]:
    """Every stylesheet, in name order — the cascade order does not matter here."""
    return sorted(STYLESHEETS.glob("*.css"))


def blocks_with_source() -> list[tuple[Path, list[str], Block]]:
    """(path, file lines, block) for every rule block in every stylesheet."""
    found: list[tuple[Path, list[str], Block]] = []
    for path in stylesheets():
        lines = path.read_text().splitlines()
        found.extend((path, lines, block) for block in rule_blocks(lines))
    return found


def inset_accent(decl: str) -> bool:
    """Report whether this declaration is an inset box-shadow painted in the accent."""
    return bool(BOX_SHADOW.match(decl)) and "inset" in decl and "--accent" in decl


def exempted(lines: list[str], first: int, last: int) -> bool:
    """Report whether the block, or the line above it, carries a pragma with a reason."""
    return any(EXEMPT.search(line) for line in lines[max(first - 2, 0) : last])


def widget_kinds() -> set[str]:
    """Every widget kind the control table actually uses."""
    return {str(entry["widget"]) for entry in load_schema().values() if entry.get("widget")}


def check_decided(kinds: set[str]) -> list[str]:
    """Every widget kind is in one of the two tables."""
    known = set(BORDER_WIDGETS) | set(RING_WIDGETS)
    return [
        f"widget {kind!r}: no staged-edit marking. Add it to BORDER_WIDGETS (the control has a "
        f"border to recolour) or RING_WIDGETS (it has none) in {Path(__file__).name}, and write "
        f"the rule in {DEFINITION_SITE}"
        for kind in sorted(kinds - known)
    ]


def check_border_rules(kinds: set[str], blocks: list[tuple[Path, list[str], Block]]) -> list[str]:
    """Every bordered widget in use has a rule recolouring that border when dirty."""
    problems = []
    for kind in sorted(kinds & set(BORDER_WIDGETS)):
        control = BORDER_WIDGETS[kind]
        if any(
            ".dirty" in selector and control in selector and any(BORDER_ACCENT.match(d) for d in decls)
            for _, _, (selector, _, _, decls) in blocks
        ):
            continue
        problems.append(
            f"widget {kind!r}: no rule turns {control} accent when its field is dirty — "
            f"a staged edit to it is invisible. Write it in {DEFINITION_SITE}"
        )
    return problems


def check_ring_rules(kinds: set[str], blocks: list[tuple[Path, list[str], Block]]) -> list[str]:
    """Every borderless widget in use has the row ring scoped to it."""
    problems = []
    for kind in sorted(kinds & set(RING_WIDGETS)):
        scope = f".field-{kind}.dirty"
        # ":" excluded so a `:hover` restatement of the ring cannot stand in for
        # the resting rule — the hover copy exists to survive the row tint, and a
        # highlight you only see under the pointer is not a highlight.
        if any(
            scope in selector and ":" not in selector and any(inset_accent(d) for d in decls)
            for _, _, (selector, _, _, decls) in blocks
        ):
            continue
        problems.append(
            f"widget {kind!r}: no row ring at {scope} — it has no border of its own to "
            f"recolour, so a staged edit to it is invisible. Write it in {DEFINITION_SITE}"
        )
    return problems


def ring_scoped(selector: str) -> bool:
    """Report whether every dirty part of this selector names a borderless widget."""
    parts = [part for part in selector.split(",") if ".dirty" in part]
    return bool(parts) and all(any(f".field-{kind}." in part for kind in RING_WIDGETS) for part in parts)


def check_ring_scope(blocks: list[tuple[Path, list[str], Block]]) -> list[str]:
    """No inset accent ring reaches a control that can paint over it."""
    problems = []
    for path, lines, (selector, first, last, decls) in blocks:
        if ".dirty" not in selector or not any(inset_accent(d) for d in decls):
            continue
        if ring_scoped(selector) or exempted(lines, first, last):
            continue
        problems.append(
            f"{path.relative_to(ROOT)}:{first}: {selector} — inset accent ring on a dirty row "
            f"that is not scoped to {' / '.join(RING_WIDGETS)}. An inset shadow paints under the "
            f"row's own children, so a control filling its field covers the ring; recolour that "
            f"control's border instead"
        )
    return problems


def main() -> int:
    kinds = widget_kinds()
    blocks = blocks_with_source()
    problems = (
        check_decided(kinds)
        + check_border_rules(kinds, blocks)
        + check_ring_rules(kinds, blocks)
        + check_ring_scope(blocks)
    )
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} staged-edit marking problem(s). See {DEFINITION_SITE},")
        print(f"or mark the rule /* {PRAGMA} <reason> */ if it genuinely cannot be covered.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
