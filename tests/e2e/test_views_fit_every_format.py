"""Every view the header swaps the body to fits, on every rail entry and tab, at every plate format.

The header's gear and its two builders (Station builder, Snapshot builder) each
swap the plate's whole body for a view of their own. No part of such a view
develops a scroll bar and none cuts content off past its box, on any entry of
the view's rail or any tab that entry opens, at each of the three plate formats
the design system names (Expanded 1366x1024, Normal 1180x820, Compact
1133x744). Two boxes are the user's own and may scroll: a matrix profile's
description and the engine log tail.

Each case lays the plate out for a window exactly the size of one format, so the
window picks that format at a scale of 1, taps one header button, and walks the
view's rail: it taps each entry the rail shows in turn, shows each tab that
entry opens, and measures how much content lies beyond the box it is seen
through (`e2e.support.fit`).

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- The view's rail is the enumeration authority for its entries, and the tab
  strip an entry opens for its tabs: the walk taps what the view offers rather
  than a list written here, including entries a tap reveals (a station fold's
  snapshots, another page of them). Each entry is tapped once, known by the
  element itself rather than by anything it reads. A failure names every entry
  and tab that hides content in that view at that format, as
  `<n>:<entry>/<tab>`, with the box and the hidden length; `n` is the entry's
  place in the walk and `-/-` is the view as it opens. A walk that would tap
  more than `MAX_ENTRIES` entries fails rather than stopping short.
- Controls are found by machine identity: the header buttons (`data-testid`),
  the swapped body (`data-body`), the rail's entries (the body's `nav` buttons
  and its `data-stage` buttons, named by their `data-*` identity or their
  classes), an open drawer (`aside.drawer` not carrying `data-closed`) and its
  close key, tabs (`role` and `data-tab`), and the two exempt boxes
  (`data-testid`).
- The view is measured whole: rail, page and any open drawer. A closed panel
  (`data-closed`), a popover panel and a tooltip are not content of the view as
  shown; popovers and sheets are measured elsewhere. A view that shows no rail
  is measured as it opens.
- Waits are bounded condition-polls: fonts loaded, a drawer closed, the body
  swapped, its wipe and every other finite animation settled.
"""

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import fit
from e2e.support import stack as stack_support

#: The header buttons that swap the plate's body: the gear and the two builders.
VIEWS = ("settings", "station-builder", "snapshot-builder")

#: What is not content of the view as shown: a closed panel, a popover panel, a tooltip.
OFFSTAGE = '[data-closed], [data-pop], [role="tooltip"]'

#: Ceiling on rail entries tapped in one view, so a rail that keeps revealing entries still ends, and fails.
MAX_ENTRIES = 80

#: Shared by the walk's steps: the shown body, the open drawer, the rail's entries and the tabs on show.
VIEW_JS = """
const BODY = ".body[data-body]";
const OPEN = "aside.drawer:not([data-closed])";
const shown = (el) => el.getClientRects().length > 0;
const body = () => [...document.querySelectorAll(BODY)].find(shown) ?? null;
const IDENTITY = ["data-stage", "data-step", "data-station", "data-testid", "data-k", "data-v", "data-tab"];
const ident = (el) => {
  const k = IDENTITY.find((a) => el.hasAttribute(a));
  if (k !== undefined) return `[${k}="${el.getAttribute(k)}"]`;
  return el.classList.length > 0 ? "." + [...el.classList].join(".") : el.tagName.toLowerCase();
};
const entries = (root) => {
  const els = [...root.querySelectorAll('nav button, button[data-stage]')].filter(
    (b) => shown(b) && !b.disabled && b.getAttribute("role") !== "tab"
      && b.closest("aside.drawer") === null && b.closest("[data-pop]") === null,
  );
  const count = new Map();
  return els.map((el) => {
    const id = ident(el);
    const n = (count.get(id) ?? 0) + 1;
    count.set(id, n);
    return [n === 1 ? id : `${id}#${n}`, el];
  });
};
const tabs = (root) => {
  const strip = root.querySelector(OPEN) ?? root;
  return [...strip.querySelectorAll('[role="tab"]')]
    .filter((t) => shown(t) && t.closest("[data-pop]") === null)
    .map((t, i) => [t.dataset.tab ?? String(i), t]);
};
"""

#: Taps the header button `view`, waits for its body, settles, and returns the `data-body` it shows.
SWAP_JS = "async ({ view, ceiling }) => {" + fit.PRELUDE_JS + VIEW_JS + """
  document.querySelector(`[data-testid="${view}"]`).click();
  await until(() => body() !== null && body().dataset.body !== "chain", ceiling, `the ${view} body to show`);
  await settle(ceiling);
  return body().dataset.body;
}
"""

#: Whether the shown body has a rail.
HAS_RAIL_JS = "() => {" + VIEW_JS + """
  const root = body();
  return root !== null && root.querySelector("nav") !== null;
}
"""

#: Closes any open drawer in the view, taps the first entry the rail shows that is not in
#: `walked`, adds it there, settles, and returns its name and the `data-tab` of each tab it
#: opens (an empty list for none), or null when every entry on show is walked.
NEXT_JS = "async ({ walked, ceiling }) => {" + fit.PRELUDE_JS + VIEW_JS + """
  const open = body().querySelector(OPEN);
  if (open !== null) {
    open.querySelector('[data-testid="drawer-close"]').click();
    await until(() => body().querySelector(OPEN) === null, ceiling, "the open drawer to close");
  }
  const next = entries(body()).find(([, el]) => !walked.has(el));
  if (next === undefined) return null;
  walked.add(next[1]);
  next[1].click();
  await settle(ceiling);
  return [next[0], tabs(body()).map(([id]) => id)];
}
"""

#: Shows `tab` (none for the entry as it opens), settles, and returns each box
#: the view's content runs more than `rounding` px past, worst first, as
#: "<box> <axis> <px>".
MEASURE_JS = "async ({ tab, skip, rounding, ceiling }) => {" + fit.PRELUDE_JS + VIEW_JS + """
  if (tab !== null) {
    const pick = tabs(body()).find(([id]) => id === tab);
    if (pick !== undefined) {
      pick[1].click();
      await settle(ceiling);
    }
  }
  return hiddenPast(body(), skip, "the view", rounding);
}
"""


class _NothingWalkedError(RuntimeError):
    """The view showed a rail with no entry to tap, so the walk measured no rail entry."""

    def __init__(self, view: str) -> None:
        super().__init__(f"the {view} view showed a rail with no entry, so no rail entry was measured")


class _WalkCutShortError(RuntimeError):
    """The view's rail offered more entries than the walk may tap, so entries past the ceiling went unmeasured."""

    def __init__(self, view: str) -> None:
        super().__init__(f"the {view} view's rail offered more than {MAX_ENTRIES} entries, so the walk stopped short")


def _hidden(page: Page, tab: str | None) -> list[str]:
    """Show `tab` in the view as it stands and return each box the view's content runs past."""
    args = {
        "tab": tab,
        "skip": f"{fit.EXEMPT}, {OFFSTAGE}",
        "rounding": fit.ROUNDING,
        "ceiling": fit.SETTLE_TIMEOUT,
    }
    return [str(line) for line in page.evaluate(MEASURE_JS, args)]


def _hidden_by_entry(page: Page, stack: stack_support.Stack, size: ViewportSize, view: str) -> dict[str, list[str]]:
    """Open `view` at `size`, walk every rail entry and tab, return each that hides content and what."""
    fit.load_plate(page, stack, size)
    page.evaluate(SWAP_JS, {"view": view, "ceiling": fit.SETTLE_TIMEOUT})
    found = {"-/-": _hidden(page, None)}
    if not page.evaluate(HAS_RAIL_JS):
        return {where: lines for where, lines in found.items() if lines}
    walked = page.evaluate_handle("() => new WeakSet()")
    args = {"walked": walked, "ceiling": fit.SETTLE_TIMEOUT}
    tapped = 0
    while (step := page.evaluate(NEXT_JS, args)) is not None:
        if tapped == MAX_ENTRIES:
            raise _WalkCutShortError(view)
        tapped += 1
        entry, tabs = step
        for tab in tabs or [None]:
            found[f"{tapped}:{entry}/{tab or '-'}"] = _hidden(page, tab)
    if tapped == 0:
        raise _NothingWalkedError(view)
    return {where: lines for where, lines in found.items() if lines}


@pytest.mark.parametrize("plate", sorted(fit.FORMATS))
@pytest.mark.parametrize("view", VIEWS)
def test_no_view_entry_or_tab_scrolls_or_cuts_off_content(
    page: Page, stack: stack_support.Stack, view: str, plate: str
) -> None:
    """In this view at this format, no rail entry or tab hides content."""
    assert _hidden_by_entry(page, stack, fit.FORMATS[plate], view) == {}
