"""Browser end-to-end pin on the Hardware acceleration card's load: an edit made while it is out survives it.

The card renders its defaults at once and reads the daemon's six engine settings
in the background. A user can change a setting before that read answers; when it
does, the setting they moved keeps their choice and the apply button marks it.

The read is held back with a route on the page, so "before the read answers" is
a state the case is put in rather than a race it hopes to win. The case waits
for the edit to land on the control and for the read's answer, then asserts what
the button did about it. Every wait is a bounded poll on a condition or two
animation frames (docs/testing.md rule 7).

Why here and not in `tests/js/lib/keepedits.test.js`: that suite pins which value
each setting shows once the read lands. The card handing that decision what the
settings were when the read went out runs in its load, inside a `useEffect`,
which `preact-render-to-string` never runs.

"Set manually" under Blocks / cycle is the setting moved: the card's default
(automatic, `nblocks="0"`) and the fake's `nblocks="16"`
(`tests/support/fake_config_xml.py`) both differ from what ticking it seeds, so
the user's value is told apart from both.
"""

from urllib.parse import urlparse

from narrow import FixtureError
from playwright.sync_api import Page, Route

from e2e.support.hwcard import (
    CHECKBOX,
    DIRTY,
    ENGINE_PATH,
    SETTLE_MS,
    apply_classes,
    change_setting,
    flush_frames,
    is_engine_answer,
    is_engine_read,
    open_hardware_card,
)
from e2e.support.stack import Stack

BLOCKS = "blocks_per_cycle"

#: How many frame pairs to let pass while waiting for the card to send its read:
#: a ceiling on a condition poll, counted in frames, never a duration.
HOLD_FRAMES = 200


def hold_engine_read(page: Page) -> list[Route]:
    """Keep the card's first engine read from reaching the server; hand back the list it lands in.

    Installed before the page loads, so the card renders and takes edits while
    its read is out, the way a slow daemon leaves it.
    """
    held: list[Route] = []

    def handle(route: Route) -> None:
        if is_engine_read(route.request) and not held:
            held.append(route)
        else:
            route.continue_()

    page.route(lambda url: urlparse(url).path == ENGINE_PATH, handle)
    return held


def release_engine_read(page: Page, held: list[Route]) -> None:
    """Let the held engine read through and wait until its answer has reached the card."""
    for _ in range(HOLD_FRAMES):
        if held:
            break
        flush_frames(page)
    if not held:
        raise FixtureError(reason="the card never sent its engine read, so there was nothing to hold")
    with page.expect_response(is_engine_answer, timeout=SETTLE_MS):
        held[0].continue_()
    flush_frames(page)


def test_a_setting_changed_before_the_load_lands_keeps_the_apply_button_marked(page: Page, stack: Stack) -> None:
    """The user's edit outlives the daemon's answer, so it is still an unapplied change."""
    held = hold_engine_read(page)
    open_hardware_card(page, stack)
    change_setting(page, BLOCKS, CHECKBOX)
    release_engine_read(page, held)
    assert DIRTY in apply_classes(page)
