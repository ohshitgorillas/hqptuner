"""Every drawer the rail opens fits on every one of its tabs, with every pick, at every plate format.

No drawer develops a scroll bar and none cuts content off past its box, on any
of its tabs, at each of the three plate formats the design system names
(Expanded 1366x1024, Normal 1180x820, Compact 1133x744), in every state a user
can put it in: as it opens, and with each pick it offers that changes what it
shows (a line, a mode, an option) applied, one pick at a time. Two boxes are
the user's own and may scroll: a matrix profile's description and the engine
log tail.

Each case lays the plate out for a window exactly the size of one format, so
the window picks that format at a scale of 1, then walks the rail: it opens
each stage's drawer in turn, shows each of that drawer's tabs, and measures
how much content lies beyond the box it is seen through (`e2e.support.fit`).
On each tab it then takes every pick on show in turn: applies it, measures the
drawer again, and puts the drawer back as it was before the next pick.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- The rail is the enumeration authority for which drawers exist, each
  drawer's tab strip for which tabs it has, and each tab for which picks it
  offers, the way the running engine is for names: the walk opens and takes
  what the plate offers rather than a list written here. A failure names
  every drawer, tab and pick that hides content at that format, as
  `<data-stage>/<data-tab>` and, for a pick, `with <pick>`, with the box and
  the hidden length.
- A pick is a control on show and enabled that picks a value: a radio, a
  switch, a check box, a select's option, or a button or list item carrying
  an option value (`data-v`). Tabs, a drawer's close and discard keys and the
  triggers that open a popover are not picks; tabs are walked here, popovers
  in their own sweep. A pick is named by the row around it (`data-k`,
  `data-field`, `data-body`) and its value.
- One pick at a time: after measuring, every pick on show that the tap moved
  is put back (a radio or option by tapping the one that was lit, a switch or
  check box by tapping it again, a select by its old value) and any staged
  edit is discarded. A pick that went missing before its turn, closed its
  drawer, or left the drawer unrestored fails the case, since each leaves part
  of the walk unmeasured or measured in a state no single pick reaches.
- Controls are found by machine identity: the rail stage (`data-stage`), the
  open drawer (the one `aside.drawer` not carrying `data-closed`, the stage's
  own being `#drawer-<stage>`), its close and discard keys (`data-testid`), its
  tabs (`role` and `data-tab`), and the two exempt boxes (`data-testid`).
- The surface measured is the open drawer.
- Waits are bounded condition-polls: fonts loaded, the drawer opened or closed,
  a pick's requests answered, its wipe and every other finite animation
  settled.
"""

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import fit
from e2e.support import stack as stack_support

#: The stage of every rail button the plate shows, in rail order.
STAGES_JS = """
() => [...document.querySelectorAll("button[data-stage]")]
  .filter((b) => b.getClientRects().length > 0)
  .map((b) => b.dataset.stage)
"""

#: The open drawer.
OPEN = 'const OPEN = "aside.drawer:not([data-closed])";'

#: Closes any open drawer, opens `stage`'s, settles it, and returns the `data-tab`
#: of each tab its strip shows (an empty list for a drawer with one part).
OPEN_JS = "async ({ stage, ceiling }) => {" + fit.PRELUDE_JS + OPEN + """
  const open = document.querySelector(OPEN);
  if (open !== null) {
    open.querySelector('[data-testid="drawer-close"]').click();
    await until(() => document.querySelector(OPEN) === null, ceiling, "the open drawer to close");
  }
  document.querySelector(`button[data-stage="${stage}"]`).click();
  await until(() => document.querySelector(OPEN) !== null, ceiling, `the ${stage} drawer to open`);
  await settle(ceiling);
  const drawer = document.querySelector(OPEN);
  return [...drawer.querySelectorAll('[role="tab"]')]
    .filter((t) => t.getClientRects().length > 0)
    .map((t, i) => t.dataset.tab ?? String(i));
}
"""

#: Counts the page's requests in flight, so a pick's wait can end when the engine has answered it.
COUNT_REQUESTS_JS = """
() => {
  if (window.__fitInflight !== undefined) return;
  window.__fitInflight = { n: 0 };
  const send = window.fetch;
  window.fetch = (...args) => {
    window.__fitInflight.n += 1;
    return send.apply(window, args).finally(() => { window.__fitInflight.n -= 1; });
  };
}
"""

#: Helpers over the open drawer: `ensure(stage, ceiling)` opens `stage`'s drawer unless it is
#: the open one, `showTab(tab, ceiling)` shows a tab on it, `picks(drawer)` lists every pick on
#: show as `{ key, el, value }`, `state(drawer)` maps each pick's key to what it reads now,
#: `take(pick)` applies one, `putBack(stage, tab, before, ceiling)` restores what it moved, and
#: `quiet(ceiling)` waits out the page's requests and settles.
PICKS_PRELUDE_JS = fit.PRELUDE_JS + OPEN + """
const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const quiet = async (ceiling) => {
  await until(() => window.__fitInflight === undefined || window.__fitInflight.n === 0, ceiling,
    "the pick's requests to be answered");
  await settle(ceiling);
};
const ensure = async (stage, ceiling) => {
  const mine = document.getElementById(`drawer-${stage}`);
  if (mine !== null && !mine.hasAttribute("data-closed")) return mine;
  const open = document.querySelector(OPEN);
  if (open !== null) {
    open.querySelector('[data-testid="drawer-close"]').click();
    await until(() => document.querySelector(OPEN) === null, ceiling, "the open drawer to close");
  }
  document.querySelector(`button[data-stage="${stage}"]`).click();
  await until(() => document.querySelector(OPEN) !== null, ceiling, `the ${stage} drawer to open`);
  await settle(ceiling);
  return document.querySelector(OPEN);
};
const showTab = async (tab, ceiling) => {
  if (tab === null) return;
  const tabs = [...document.querySelector(OPEN).querySelectorAll('[role="tab"]')].filter(shown);
  tabs.find((t, i) => (t.dataset.tab ?? String(i)) === tab).click();
  await settle(ceiling);
};
const PICKABLE = '[role="radio"], [role="switch"], [data-v], select, input[type="checkbox"], input[type="radio"]';
const NOT_PICKS = '[role="tab"], [role="tablist"] *, [aria-haspopup], [aria-expanded], '
  + '[data-testid="drawer-close"], [data-testid="discard"]';
const dead = (el) => el.disabled === true || el.closest('[aria-disabled="true"], [inert], fieldset:disabled') !== null;
const toggle = (el) => el.getAttribute("role") === "switch"
  || (el instanceof HTMLInputElement && el.type === "checkbox");
const lit = (el) => {
  if (el instanceof HTMLInputElement) return el.checked;
  if (["aria-checked", "aria-pressed", "aria-selected"].some((a) => el.getAttribute(a) === "true")) return true;
  return el.classList.contains("on") || el.classList.contains("cur");
};
const rowOf = (el, drawer) => {
  for (let a = el; a !== null && a !== drawer; a = a.parentElement) {
    const k = ["data-k", "data-field", "data-body"].find((name) => a.hasAttribute(name));
    if (k !== undefined) return `[${k}="${a.getAttribute(k)}"] `;
  }
  return "";
};
const valueOf = (el) => el.closest("[data-v]")?.dataset.v ?? el.getAttribute("aria-label")
  ?? el.textContent.trim().replace(/\\s+/g, " ").slice(0, 40);
const picks = (drawer) => {
  const els = [...drawer.querySelectorAll(PICKABLE)].filter((el) => !el.matches(NOT_PICKS) && shown(el) && !dead(el));
  const inner = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
  const out = [];
  const met = new Map();
  const add = (key, el, value) => {
    const n = (met.get(key) ?? 0) + 1;
    met.set(key, n);
    out.push({ key: n === 1 ? key : `${key} #${n}`, el, value });
  };
  for (const el of inner) {
    const row = rowOf(el, drawer);
    if (el instanceof HTMLSelectElement) {
      for (const o of el.options) add(`${row}option ${o.value}`, el, o.value);
    } else {
      add(`${row}${toggle(el) ? "switch " : ""}${valueOf(el)}`, el, null);
    }
  }
  return out;
};
const reads = (p) => (p.value === null ? lit(p.el) : p.el.value === p.value);
const state = (drawer) => new Map(picks(drawer).map((p) => [p.key, reads(p)]));
const choose = (select, value) => {
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
};
const take = (p) => (p.value === null ? p.el.click() : choose(p.el, p.value));
const moved = (before) => picks(document.querySelector(OPEN))
  .filter((p) => before.has(p.key) && before.get(p.key) !== reads(p));
const RESTORE_ROUNDS = 8;
const putBack = async (stage, tab, before, ceiling) => {
  await ensure(stage, ceiling);
  await showTab(tab, ceiling);
  for (let round = 0; round < RESTORE_ROUNDS; round += 1) {
    const fix = moved(before).find((p) => before.get(p.key) || toggle(p.el));
    if (fix === undefined) break;
    take(fix);
    await quiet(ceiling);
  }
  const discard = document.querySelector(OPEN).querySelector('[data-testid="discard"]');
  if (discard !== null && shown(discard) && !discard.disabled) {
    discard.click();
    await quiet(ceiling);
  }
  return moved(before).map((p) => p.key);
};
"""

#: Shows `tab` on `stage`'s drawer (none for a drawer with one part), settles, and returns
#: each box the drawer's content runs more than `rounding` px past, worst first, as
#: "<box> <axis> <px>".
MEASURE_JS = "async ({ stage, tab, skip, rounding, ceiling }) => {" + PICKS_PRELUDE_JS + """
  await ensure(stage, ceiling);
  await showTab(tab, ceiling);
  return hiddenPast(document.querySelector(OPEN), skip, "the drawer", rounding);
}
"""

#: Shows `tab` on `stage`'s drawer and returns the key of every pick on show that would change
#: what the drawer reads: each option not lit and each switch.
PICK_KEYS_JS = "async ({ stage, tab, ceiling }) => {" + PICKS_PRELUDE_JS + """
  await ensure(stage, ceiling);
  await showTab(tab, ceiling);
  return picks(document.querySelector(OPEN)).filter((p) => toggle(p.el) || !reads(p)).map((p) => p.key);
}
"""

#: Shows `tab` on `stage`'s drawer, applies the pick `key`, waits for its requests and settles,
#: measures the drawer as `MEASURE_JS` does, then puts back every pick it moved and discards
#: what it staged. Returns the measure, plus a line for a pick that went missing, closed the
#: drawer, or left it unrestored.
PICK_JS = "async ({ stage, tab, key, skip, rounding, ceiling }) => {" + PICKS_PRELUDE_JS + """
  await ensure(stage, ceiling);
  await showTab(tab, ceiling);
  const drawer = document.querySelector(OPEN);
  const before = state(drawer);
  const pick = picks(drawer).find((p) => p.key === key);
  if (pick === undefined) return ["the pick went missing before its turn"];
  take(pick);
  await quiet(ceiling);
  const now = document.querySelector(OPEN);
  const lines = now === drawer ? hiddenPast(now, skip, "the drawer", rounding) : ["the pick closed the drawer"];
  const left = await putBack(stage, tab, before, ceiling);
  return left.length === 0 ? lines : [...lines, `the drawer was left with ${left.join(", ")} moved`];
}
"""


class _NothingWalkedError(RuntimeError):
    """The rail offered no stage to open, so the walk measured no drawer."""

    def __init__(self) -> None:
        super().__init__("the rail showed no stage button, so no drawer was measured")


def _hidden_on_tab(page: Page, stage: str, tab: str | None) -> dict[str, list[str]]:
    """Measure one drawer tab as it shows, then with each of its picks applied in turn; return each hiding content."""
    place = f"{stage}/{tab or '-'}"
    where = {"stage": stage, "tab": tab, "ceiling": fit.SETTLE_TIMEOUT}
    measure = {**where, "skip": fit.EXEMPT, "rounding": fit.ROUNDING}
    found: dict[str, list[str]] = {}
    lines = [str(line) for line in page.evaluate(MEASURE_JS, measure)]
    if lines:
        found[place] = lines
    for key in [str(key) for key in page.evaluate(PICK_KEYS_JS, where)]:
        lines = [str(line) for line in page.evaluate(PICK_JS, {**measure, "key": key})]
        if lines:
            found[f"{place} with {key}"] = lines
    return found


def _hidden_by_tab(page: Page, stack: stack_support.Stack, size: ViewportSize) -> dict[str, list[str]]:
    """Lay the plate out for a window of `size`, walk every drawer tab and pick, return each hiding content and what."""
    fit.load_plate(page, stack, size)
    page.evaluate(COUNT_REQUESTS_JS)
    stages = [str(stage) for stage in page.evaluate(STAGES_JS)]
    if not stages:
        raise _NothingWalkedError
    found: dict[str, list[str]] = {}
    for stage in stages:
        tabs = page.evaluate(OPEN_JS, {"stage": stage, "ceiling": fit.SETTLE_TIMEOUT})
        for tab in tabs or [None]:
            found.update(_hidden_on_tab(page, stage, tab))
    return found


@pytest.mark.parametrize("plate", sorted(fit.FORMATS))
def test_no_drawer_tab_scrolls_or_cuts_off_content(page: Page, stack: stack_support.Stack, plate: str) -> None:
    """At this format, no tab of any drawer the rail opens hides content, as it opens or with any one pick applied."""
    assert _hidden_by_tab(page, stack, fit.FORMATS[plate]) == {}
