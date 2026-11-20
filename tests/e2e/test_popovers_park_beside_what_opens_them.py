"""Each popover a site parks opens beside the element it parks against, on the side its placement names.

Nine sites hand their panel to `place()` or `parkPanel()` in `Popover.js`: an alert note
against its home element, the HF filter menu, a `see more` note, the volume panel,
the bottom bar's menus, the pipeline `+` menus, a list's facet panels, the Display
options and the filter presets. A panel left where the stylesheet puts it, or moved
against some other element, still fits the plate, so the fit suite
(`test_popovers_fit_every_format.py`) passes either way. This one reads where each lands.

The plate is walked as the fit suite walks it, at one of its three formats (Normal,
1180x820): every trigger on show on the plate and in each drawer tab is tapped and each
surface that opens is read, its box, the box of the element it parks against and the
plate's. A panel opens against the button that carries its id, or, for an alert note,
the element that does. What a site's placement names is held, not the gap it leaves:

- below: the panel starts at or under the element's foot and overlaps it across;
- flip: the same, or it ends at or over the element's top where under would cross the
  plate's foot;
- before: the panel ends at or before the element's left, and its top is level with the
  element's top or raised off the plate's foot, so it still stands across from it.

Each of those lies within a short reach of the element, far beyond any gap a site sets
and well short of where a panel stands unplaced, and every panel stands inside the plate.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- The running app is the enumeration authority for which popovers exist. A site is told
  from its panel's classes and id, and a site none of whose panels was opened fails by
  name.
- Two sites the stack cannot bring up are not read here: the volume panel, whose trigger
  is disabled because the stack's engine config pins the volume, and the alert note, for
  which the stack raises no alert. A facet panel opens from the list a chain picker
  opens, which the walk does not enter, so it has its own case.
- The walk, the plate's formats and the settle waits are the fit suite's, so a change to
  how a trigger is reached is made once.
"""

import json
from dataclasses import dataclass
from typing import Any

from playwright.sync_api import Page

from e2e import test_popovers_fit_every_format as walks
from e2e.support import fit
from e2e.support import stack as stack_support

#: The plate format this reads at; the others are the fit suite's.
FORMAT = "normal"

#: How far a panel may stand from the element it parks against and still read as beside it, CSS px: past every gap a
#: site sets, short of a panel stood unplaced.
REACH = 24

#: Layout rounding a box edge may differ by, CSS px.
ROUNDING = fit.ROUNDING

#: What each surface the walk opens is read as: for a popover panel, its classes, id and the boxes it is read against.
MEASURE_JS = """(surface) => {
  if (!surface.matches("[data-pop]:not(button)")) return [];
  const plate = surface.closest(".plate");
  const id = surface.dataset.pop;
  const home = plate.querySelector(`button[data-pop="${id}"]`) ?? plate.querySelector(`[data-pop="${id}"]:not(.pop)`);
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const inside = plate.getBoundingClientRect();
  return [JSON.stringify({
    id,
    classes: [...surface.classList],
    panel: box(surface.getBoundingClientRect()),
    home: home === null ? null : box(home.getBoundingClientRect()),
    plate: box({
      left: inside.left + plate.clientLeft,
      top: inside.top + plate.clientTop,
      right: inside.left + plate.clientLeft + plate.clientWidth,
      bottom: inside.top + plate.clientTop + plate.clientHeight,
    }),
  })];
}"""

Box = dict[str, float]


@dataclass(frozen=True)
class Reading:
    """One opened popover panel: what it is, where it stands, the element it parks against and the plate."""

    id: str
    classes: frozenset[str]
    panel: Box
    home: Box | None
    plate: Box


def _across(panel: Box, home: Box) -> bool:
    """Whether the panel and its element overlap left to right."""
    return panel["left"] < home["right"] and home["left"] < panel["right"]


def _below(panel: Box, home: Box) -> bool:
    """Whether the panel starts at or under its element's foot, within reach, and overlaps it across."""
    return -ROUNDING <= panel["top"] - home["bottom"] <= REACH and _across(panel, home)


def _above(panel: Box, home: Box) -> bool:
    """Whether the panel ends at or over its element's top, within reach, and overlaps it across."""
    return -ROUNDING <= home["top"] - panel["bottom"] <= REACH and _across(panel, home)


def _before(panel: Box, home: Box) -> bool:
    """Whether the panel ends at or before its element's left, within reach, standing across from it."""
    level = panel["top"] <= home["top"] + ROUNDING and home["top"] < panel["bottom"]
    return -ROUNDING <= home["left"] - panel["right"] <= REACH and level


#: The placements the sites name, each a read of one panel against its element.
PLACEMENTS = {"below": _below, "flip": lambda p, h: _below(p, h) or _above(p, h), "before": _before}


@dataclass(frozen=True)
class Site:
    """One site: how its panels are told, and the placement it names."""

    name: str
    is_panel: Any
    placement: str


def _pmenu_of_the_bar(r: Reading) -> bool:
    """Whether `r` is one of the bottom bar's two menus, whose ids start `sw`."""
    return "pmenu" in r.classes and r.id.startswith("sw")


SITES = (
    Site("the HF filter menu", lambda r: "hfpop" in r.classes, "below"),
    Site("a see-more note", lambda r: "notepop" in r.classes and "alnote" not in r.classes, "flip"),
    Site("the bottom bar's menus", _pmenu_of_the_bar, "flip"),
    Site(
        "a pipeline + menu",
        lambda r: "pmenu" in r.classes and not r.classes & {"amenu", "bstmenu", "hfpop"} and not _pmenu_of_the_bar(r),
        "below",
    ),
    Site("the Display options", lambda r: "dpop" in r.classes, "before"),
    Site("the filter presets", lambda r: "fpop" in r.classes, "before"),
)

#: The site whose panels open from a list, read by its own case.
FACETS = Site("a facet panel", lambda r: "fpop2" in r.classes, "below")


def _readings(found: dict[str, list[str]]) -> list[Reading]:
    """Every popover panel the walk read, by the trigger path it was opened from."""
    out = []
    for lines in found.values():
        for line in lines:
            raw = json.loads(line)
            out.append(Reading(raw["id"], frozenset(raw["classes"]), raw["panel"], raw["home"], raw["plate"]))
    return out


def _off_the_plate(r: Reading) -> bool:
    """Whether any edge of the panel lies outside the plate's padding box."""
    return (
        r.panel["left"] < r.plate["left"] - ROUNDING
        or r.panel["top"] < r.plate["top"] - ROUNDING
        or r.panel["right"] > r.plate["right"] + ROUNDING
        or r.panel["bottom"] > r.plate["bottom"] + ROUNDING
    )


def _misplaced(site: Site, readings: list[Reading]) -> list[str]:
    """What is wrong with each panel of `site`: no element to park against, off its side, or off the plate."""
    panels = [r for r in readings if site.is_panel(r)]
    wrong = [] if panels else ["the walk opened no panel of this site"]
    for r in panels:
        if r.home is None:
            wrong.append(f"{r.id}: no element carries its id to park against")
        elif not PLACEMENTS[site.placement](r.panel, r.home):
            wrong.append(f"{r.id}: not {site.placement} its element: panel {r.panel}, element {r.home}")
        elif _off_the_plate(r):
            wrong.append(f"{r.id}: outside the plate: panel {r.panel}, plate {r.plate}")
    return wrong


def test_each_popover_opens_beside_the_element_it_parks_against_inside_the_plate(
    page: Page, stack: stack_support.Stack
) -> None:
    """Every panel a site parks stands against its element on the side the site names, inside the plate."""
    fit.load_plate(page, stack, fit.SIZES[FORMAT])
    walk = walks.Walk(page, walks.PLATE, fit.walk_js(MEASURE_JS))
    walks.walk_plate(page, walk)
    readings = _readings(walk.done())
    assert {site.name: _misplaced(site, readings) for site in SITES} == {site.name: [] for site in SITES}


def test_a_facet_panel_opens_below_its_window_inside_the_plate(page: Page, stack: stack_support.Stack) -> None:
    """The first facet panel a chain picker's list offers stands under its window, inside the plate."""
    fit.load_plate(page, stack, fit.SIZES[FORMAT])
    page.evaluate(walks.CLOSE_JS, {"ceiling": fit.SETTLE_TIMEOUT})
    page.locator("button.cplate[data-list]:visible").first.click(timeout=fit.SETTLE_TIMEOUT)
    window = page.locator("button[data-window]:visible").first
    window.click(timeout=fit.SETTLE_TIMEOUT)
    panel = page.locator(f'.pop[data-pop="{window.get_attribute("data-pop")}"]:visible')
    panel.wait_for(timeout=fit.SETTLE_TIMEOUT)
    readings = _readings({"facet": panel.evaluate(MEASURE_JS)})
    assert {FACETS.name: _misplaced(FACETS, readings)} == {FACETS.name: []}
