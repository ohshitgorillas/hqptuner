"""An ordinary setting, changed in its drawer and applied, reaches the engine.

A user opens a stage's drawer, taps the other option on an ordinary setting,
and presses Apply. Two lanes carry such a change: a live setter on the Control
API (the high-frequency filter, HF filter drawer) and the restore lane on the
8088 interface (IPv6 discovery, Output drawer, Device tab). Each test first
puts the engine on the other side, then has the user apply the target, so every
case has a transition to observe and the two cases of each lane expect
distinct values.

Policy notes (docs/testing.md):

- One assertion per test; helpers return evidence.
- Controls are found by wire identity: the rail stage (`data-stage`), the
  drawer id, the tab (`data-tab`), the row's catalog key (`data-k`), the
  option value (`data-v`), the apply button's `data-testid`.
- Waits are bounded condition-polls on the engine or the DOM. Nothing sleeps.
- The restore lane's starting side is set through the app's own REST staging
  and apply, the way any client reaches it, never by writing the fake's file
  state, which the app does not re-read on every poll.
- The restore lane's case is IPv6 discovery rather than a matrix field: the
  fake daemon's matrix form renders its checkboxes fixed, so a matrix field the
  restore changed never reads back to the page.
- Not pinned: the apply summary. No component on this branch reads the
  verdict the store records for an apply, so no element renders one to assert
  on; the verdict's wording is covered in the JS store suite.
- Not pinned here: the apply report's per-lane outcome. The REST lane already
  covers it, so a browser copy would constrain nothing more (rule 15).
"""

import json
import threading
import urllib.request
from collections.abc import Callable

import pytest
from playwright.sync_api import Locator, Page

from e2e.support import stack as stack_support

#: The two values of a two-way setting, as the option rows and the engine carry them.
SIDES = ("0", "1")

#: Ceiling on the UI or the engine reaching a condition already set in motion.
SETTLE_TIMEOUT = 15.0

#: The same ceiling, in the milliseconds playwright takes.
SETTLE_MS = int(SETTLE_TIMEOUT * 1000)

#: The HF filter: its rail stage and drawer, its catalog key, and the State attribute the engine reports it in.
HF_STAGE = "hf"
HF_KEY = "junk_filter"
HF_STATE = "filter_junk"

#: IPv6 discovery: the Output rail stage and drawer, the tab that holds it, and its catalog key and config field.
OUTPUT_STAGE = "output"
DEVICE_TAB = "device"
IPV6_KEY = "net_ipv6"

#: The option value that turns IPv6 discovery on; the daemon's config carries it as a flag.
IPV6_ON = "1"

#: An option that is the row's effective one: a lit segment button, or the current line of an option list.
CURRENT = ':is(.on, [aria-current="true"])'


def _other(value: str) -> str:
    return SIDES[1] if value == SIDES[0] else SIDES[0]


def _post(url: str, payload: dict[str, object]) -> None:
    """POST one JSON body to the running stack."""
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")  # noqa: S310 — loopback stack URL
    with urllib.request.urlopen(request, timeout=SETTLE_TIMEOUT):  # noqa: S310 — same
        pass


def _held(condition: threading.Condition, predicate: Callable[[], bool]) -> bool:
    """Block on one of the stack's conditions until `predicate` holds or the settle ceiling passes; whether it held."""
    with condition:
        return condition.wait_for(predicate, timeout=SETTLE_TIMEOUT)


def _drawer(page: Page, stack: stack_support.Stack, stage: str) -> Locator:
    """Load the page and open `stage`'s drawer from the rail."""
    page.goto(f"{stack.base_url}/")
    page.locator(f'nav.rail button[data-stage="{stage}"]').click(timeout=SETTLE_MS)
    return page.locator(f"#drawer-{stage}")


def _pick_and_apply(drawer: Locator, key: str, start: str, target: str) -> None:
    """Wait for `key`'s row to show `start`, tap `target`, and press the drawer's Apply."""
    row = drawer.locator(f'.drow[data-k="{key}"]')
    row.locator(f'button[data-v="{start}"]{CURRENT}').first.wait_for(state="visible", timeout=SETTLE_MS)
    row.locator(f'button[data-v="{target}"]:not([disabled])').first.click(timeout=SETTLE_MS)
    drawer.locator('[data-testid="apply"]:not([disabled])').click(timeout=SETTLE_MS)


def _apply_hf_filter(page: Page, stack: stack_support.Stack, target: str) -> str:
    """Put the HF filter on the other side, apply `target` from its drawer; the State the engine then reports."""
    stack.control_state[HF_STATE] = _other(target)
    drawer = _drawer(page, stack, HF_STAGE)
    _pick_and_apply(drawer, HF_KEY, _other(target), target)
    _held(stack.control_log.condition, lambda: stack.control_state[HF_STATE] == target)
    return stack.control_state[HF_STATE]


def _apply_ipv6(page: Page, stack: stack_support.Stack, target: str) -> bool:
    """Restore IPv6 discovery to the other side, apply `target` from its drawer; the flag the config then holds."""
    start = _other(target)
    want = target == IPV6_ON
    _post(f"{stack.base_url}/api/config/stage", {"http": {IPV6_KEY: start}})
    _post(f"{stack.base_url}/api/config/apply", {})
    drawer = _drawer(page, stack, OUTPUT_STAGE)
    drawer.locator(f'[role="tab"][data-tab="{DEVICE_TAB}"]').click(timeout=SETTLE_MS)
    _pick_and_apply(drawer, IPV6_KEY, start, target)
    _held(stack.http_state.condition, lambda: stack.http_state[IPV6_KEY] is want)
    return bool(stack.http_state[IPV6_KEY])


@pytest.mark.parametrize("target", SIDES)
def test_a_live_setting_applied_from_its_drawer_reaches_the_engine(
    page: Page, stack: stack_support.Stack, target: str
) -> None:
    """The HF filter, tapped and applied in its drawer, is what the engine's State then reports."""
    assert _apply_hf_filter(page, stack, target) == target


@pytest.mark.parametrize("target", SIDES)
def test_a_restart_setting_applied_from_its_drawer_reaches_the_engine(
    page: Page, stack: stack_support.Stack, target: str
) -> None:
    """IPv6 discovery, tapped and applied in the Output drawer, is what the daemon's config holds after the restore."""
    assert _apply_ipv6(page, stack, target) is (target == IPV6_ON)
