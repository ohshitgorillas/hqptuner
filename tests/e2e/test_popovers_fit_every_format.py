"""Every popover, menu, list, sheet, dialog and note a user can open fits, and so does the matrix profile view.

No surface a tap opens develops a scroll bar and none cuts content off past its
box, at each of the three plate formats the design system names (Expanded
1366x1024, Normal 1180x820, Compact 1133x744) and at the sizes Auto stretches
the plate to between them (`fit.AUTO_SIZES`): a popover, a menu, a list, a
sheet, a dialog or a `see more` note, wherever its trigger sits, on the plate,
in any drawer tab, or in any view the header opens. The page laid out with the
matrix profile at its top fits the same way. Two boxes are the user's own and
may scroll: a matrix profile's description and the engine log tail.

Each case lays the plate out under Auto for a window exactly the size it
measures, so the plate fills the window at a scale of 1, then walks one host: the plate
and its drawers, the page with the matrix profile at its top, or one of the
header's views. In each place the host shows it taps every trigger on show,
measures each surface that tap opened (`e2e.support.fit`), walks the triggers
inside that surface one level down, and closes it again.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- The running app is the enumeration authority for which surfaces exist: a
  trigger is a control that says it opens something, `aria-haspopup` or
  `aria-expanded`, or a `see-more` note key; a surface is what one tap of it
  newly shows that is a popover panel (`data-pop`), a dialog, a list box or a
  menu. Rail stages, tabs, a drawer's close key and the header's view buttons
  open drawers and views, which their own sweeps measure.
- Each trigger is tapped once per case, known by its own machine identity and
  the row or panel around it (`data-k`, `data-field`, `data-pop`, `data-step`,
  `data-station`), so the same popover met again on another rail entry is not
  re-walked. A failure names the place, the trigger and the box, as
  `<place> > <trigger>`, with the hidden length; the matrix profile view itself
  is `profile view`.
- A walk that measured no surface though the host had triggers on show fails,
  and so does a trigger that went missing before its turn or a surface that
  would not close, since each leaves part of the walk unmeasured. A host whose
  body is shown with no trigger on it has nothing to open, and passes.
- The matrix profile is put at the top of the page through Settings, by the
  Top of page field (`data-field="vfill"`) and its option (`data-v`).
- Waits are bounded condition-polls: fonts loaded, a drawer or body shown, a
  surface opened or closed, and every finite animation settled.
"""

from typing import Any

import pytest
from playwright.sync_api import JSHandle, Page, ViewportSize

from e2e import test_drawers_fit_every_format as drawers
from e2e import test_views_fit_every_format as views
from e2e.support import fit
from e2e.support import stack as stack_support

#: The host that walks the plate as it opens and every drawer tab the rail offers.
PLATE = "plate"

#: The host that lays the page out with the matrix profile at its top.
PROFILE = "matrix-profile"

#: The hosts each case walks: the plate, the matrix profile page and the header's three views.
HOSTS = (PLATE, PROFILE, *views.VIEWS)

#: The Top of page field in Settings, and its option that puts the matrix profile there.
TOP_OF_PAGE_FIELD = "vfill"
PROFILE_TOP = "profile"

#: The header button that opens Settings.
SETTINGS_VIEW = "settings"

#: How deep the walk follows a surface opened from inside another surface.
MAX_DEPTH = 2

#: The name the matrix profile view itself is reported under.
PROFILE_VIEW = "profile view"

#: What every step of the walk starts from: the prelude, the drawer's helpers and the place's.
STEPS_JS = fit.PRELUDE_JS + fit.DRAWER_JS + fit.PLACE_JS

#: Closes the open drawer, if any, and settles.
CLOSE_JS = "async ({ ceiling }) => {" + fit.PRELUDE_JS + fit.DRAWER_JS + """
  await closeDrawer(ceiling);
  await settle(ceiling);
}
"""

#: Shows `tab` on the open drawer, or on the shown body when no drawer is open, and settles.
TAB_JS = "async ({ tab, ceiling }) => {" + STEPS_JS + """
  const strip = document.querySelector(OPEN) ?? body();
  const tabs = [...strip.querySelectorAll('[role="tab"]')]
    .filter((t) => shown(t) && t.closest("[data-pop]") === null);
  const pick = tabs.find((t, i) => (t.dataset.tab ?? String(i)) === tab);
  if (pick !== undefined) {
    pick.click();
    await settle(ceiling);
  }
}
"""

#: Whether the Top of page option `value` is on show; taps it and settles when it is.
TOP_JS = "async ({ field, value, ceiling }) => {" + STEPS_JS + """
  const option = [...document.querySelectorAll(`[data-field="${field}"] [data-v="${value}"]`)].find(shown);
  if (option === undefined) return false;
  option.click();
  await settle(ceiling);
  return true;
}
"""

#: Whether the shown body holds a matrix profile's description box.
PROFILE_SHOWN_JS = "() => {" + fit.PLACE_JS + """
  const root = body();
  return root !== null && [...root.querySelectorAll('textarea[data-testid="profile-description"]')].some(shown);
}
"""

#: Measures the shown body whole, leaving out `skip`.
BODY_JS = "async ({ skip, rounding, ceiling }) => {" + STEPS_JS + """
  await settle(ceiling);
  return hiddenPast(body(), skip, "the view", rounding);
}
"""

#: What each tapped trigger's surface is measured by: the lines `hiddenPast` finds, as `fit.walk_js` takes it.
MEASURE_JS = "(surface, trigger, at, { skip, rounding }) => hiddenPast(surface, skip, at, rounding)"

#: The walk of the plate, a drawer or a view that measures each surface by what it hides.
WALK_JS = fit.walk_js(MEASURE_JS)


class _NothingWalkedError(RuntimeError):
    """The host offered triggers but the walk opened no surface from them, so it measured nothing."""

    def __init__(self, host: str, offered: int) -> None:
        super().__init__(
            f"the {host} walk opened no surface from the {offered} triggers on show, so nothing was measured"
        )


class WalkBrokenError(RuntimeError):
    """A trigger went missing before its turn or a surface would not close, so part of the walk went unmeasured."""

    def __init__(self, host: str, unreached: list[str], unclosed: list[str]) -> None:
        super().__init__(f"the {host} walk lost its place: unreached {unreached}, would not close {unclosed}")


class WalkCutShortError(RuntimeError):
    """The view's rail offered more entries than the walk may tap, so entries past the ceiling went unwalked."""

    def __init__(self, view: str) -> None:
        cap = views.MAX_ENTRIES
        super().__init__(f"the {view} view's rail offered more than {cap} entries, so the walk stopped short")


class _NoProfileViewError(RuntimeError):
    """The page never showed the matrix profile at its top, so the view went unmeasured."""

    def __init__(self) -> None:
        super().__init__("the page never showed the matrix profile view, so it was not measured")


class Walk:
    """One case's walk: the page, the triggers already tapped, and what the walk has found."""

    def __init__(self, page: Page, host: str, js: str = WALK_JS) -> None:
        """Start a walk on `page` for `host`, by the walk script `js`, with nothing tapped and nothing found."""
        self.page = page
        self.host = host
        self.js = js
        self.walked: JSHandle = page.evaluate_handle("() => new Set()")
        self.found: dict[str, list[str]] = {}
        self.offered = 0
        self.measured = 0
        self.unreached: list[str] = []
        self.unclosed: list[str] = []

    def place(self, root: str, name: str) -> None:
        """Walk every trigger on show in the place `root` names, filing what it finds under `name`."""
        args: dict[str, Any] = {
            "root": root,
            "walked": self.walked,
            "skip": fit.EXEMPT,
            "rounding": fit.ROUNDING,
            "ceiling": fit.SETTLE_TIMEOUT,
            "depth": MAX_DEPTH,
        }
        result = self.page.evaluate(self.js, args)
        for where, lines in result["found"].items():
            self.found[f"{name} > {where}"] = [str(line) for line in lines]
        self.offered += int(result["offered"])
        self.measured += int(result["measured"])
        self.unreached += [f"{name} > {where}" for where in result["unreached"]]
        self.unclosed += [f"{name} > {where}" for where in result["unclosed"]]

    def done(self) -> dict[str, list[str]]:
        """What the walk found, once it is known the walk lost no part of itself and opened what was offered."""
        if self.unreached or self.unclosed:
            raise WalkBrokenError(self.host, self.unreached, self.unclosed)
        if self.measured == 0 and self.offered > 0:
            raise _NothingWalkedError(self.host, self.offered)
        return self.found


def _show_tab(page: Page, tab: str | None) -> None:
    """Show `tab` on the open drawer or the shown body; none leaves the place as it opened."""
    if tab is not None:
        page.evaluate(TAB_JS, {"tab": tab, "ceiling": fit.SETTLE_TIMEOUT})


def walk_plate(page: Page, walk: Walk) -> None:
    """Walk the plate with no drawer open, then every tab of every drawer the rail opens."""
    page.evaluate(CLOSE_JS, {"ceiling": fit.SETTLE_TIMEOUT})
    walk.place("plate", "plate")
    for stage in [str(stage) for stage in page.evaluate(drawers.STAGES_JS)]:
        tabs = page.evaluate(drawers.OPEN_JS, {"stage": stage, "ceiling": fit.SETTLE_TIMEOUT})
        for tab in tabs or [None]:
            _show_tab(page, tab)
            walk.place("drawer", f"{stage}/{tab or '-'}")


def _walk_view(page: Page, walk: Walk, view: str) -> None:
    """Open `view` and walk it as it opens, then every rail entry and tab it offers."""
    page.evaluate(views.SWAP_JS, {"view": view, "ceiling": fit.SETTLE_TIMEOUT})
    walk.place("view", f"{view} -/-")
    if not page.evaluate(views.HAS_RAIL_JS):
        return
    walked = page.evaluate_handle("() => new WeakSet()")
    tapped = 0
    while (step := page.evaluate(views.NEXT_JS, {"walked": walked, "ceiling": fit.SETTLE_TIMEOUT})) is not None:
        if tapped == views.MAX_ENTRIES:
            raise WalkCutShortError(view)
        tapped += 1
        entry, tabs = step
        for tab in tabs or [None]:
            _show_tab(page, tab)
            walk.place("view", f"{view} {tapped}:{entry}/{tab or '-'}")


def _put_profile_on_top(page: Page) -> bool:
    """Open Settings and tap the Top of page option that puts the matrix profile there; whether it was found."""
    page.evaluate(views.SWAP_JS, {"view": SETTINGS_VIEW, "ceiling": fit.SETTLE_TIMEOUT})
    args = {"field": TOP_OF_PAGE_FIELD, "value": PROFILE_TOP, "ceiling": fit.SETTLE_TIMEOUT}
    if page.evaluate(TOP_JS, args):
        return True
    walked = page.evaluate_handle("() => new WeakSet()")
    while (step := page.evaluate(views.NEXT_JS, {"walked": walked, "ceiling": fit.SETTLE_TIMEOUT})) is not None:
        for tab in step[1] or [None]:
            _show_tab(page, tab)
            if page.evaluate(TOP_JS, args):
                return True
    return False


def _show_profile_view(page: Page, stack: stack_support.Stack, size: ViewportSize) -> None:
    """Put the matrix profile at the top of the page and lay the plate out again with no drawer open."""
    if not _put_profile_on_top(page):
        raise _NoProfileViewError
    fit.load_plate(page, stack, size)
    page.evaluate(CLOSE_JS, {"ceiling": fit.SETTLE_TIMEOUT})


def _walk_profile(page: Page, walk: Walk) -> None:
    """Measure the matrix profile view whole, then walk every trigger on it."""
    if not page.evaluate(PROFILE_SHOWN_JS):
        raise _NoProfileViewError
    args = {"skip": f"{fit.EXEMPT}, {views.OFFSTAGE}", "rounding": fit.ROUNDING, "ceiling": fit.SETTLE_TIMEOUT}
    lines = [str(line) for line in page.evaluate(BODY_JS, args)]
    if lines:
        walk.found[PROFILE_VIEW] = lines
    walk.place("view", PROFILE_VIEW)


def _hidden_by_surface(page: Page, stack: stack_support.Stack, size: ViewportSize, host: str) -> dict[str, list[str]]:
    """Lay the plate out at `size`, walk `host`, and return each surface that hides content and what."""
    fit.load_plate(page, stack, size)
    if host == PROFILE:
        _show_profile_view(page, stack, size)
    walk = Walk(page, host)
    if host == PLATE:
        walk_plate(page, walk)
    elif host == PROFILE:
        _walk_profile(page, walk)
    else:
        _walk_view(page, walk, host)
    return walk.done()


@pytest.mark.parametrize("plate", sorted(fit.SIZES))
@pytest.mark.parametrize("host", HOSTS)
def test_no_opened_surface_or_profile_view_scrolls_or_cuts_off_content(
    page: Page, stack: stack_support.Stack, host: str, plate: str
) -> None:
    """In this host at this format, no surface a tap opens, and not the matrix profile view, hides content."""
    assert _hidden_by_surface(page, stack, fit.SIZES[plate], host) == {}
