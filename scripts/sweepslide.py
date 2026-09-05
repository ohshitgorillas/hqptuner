#!/usr/bin/env python3
"""The slider pass of the visual sweep: 3x crops, every range slider stepped by keyboard, frames and deltas.

``slider_pass`` opens a second browser context at ``device_scale_factor`` 3,
and per tab crops every SVG and canvas, then steps every visible enabled range
slider across its whole range by keyboard, writing a frame per step and the
adjacent-frame deltas ``scripts/sweepplots.py`` derives. Keyboard is the only
path the app honours for a slider that no pointer holds; a synthetic value
write is reverted.

Outputs per tab: ``OUTDIR/<tab>-<n>-crop.png`` per plot, and per slider
``OUTDIR/<tab>-slider<n>-<frame>-crop.png`` plus ``OUTDIR/<tab>-slider<n>-frames.json``
holding every frame (value, findings, axis texts, trace vertices) and the deltas.
A slider is restored to its starting value: by press count on a numeric step,
through its number box on ``step="any"``; the readback is printed per slider.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sweepplots import PLOTS_JS, derive_plots, frame_deltas

if TYPE_CHECKING:
    from pathlib import Path

    from playwright.sync_api import Browser, ConsoleMessage, ElementHandle, Error, Page, Request, Response

# Status at or above which a response counts as a failed request rather than a served one.
HTTP_ERROR_STATUS = 400
# Long enough for a tab body to paint and a staged edit to settle through the store.
SETTLE_MS = 350
CROP_SCALE = 3
# Frames a slider pass lands across its whole range, about.
FRAMES = 20

AXIS_TEXTS_JS = "() => Array.from(document.querySelectorAll('svg text')).map(t => (t.textContent || '').trim())"

SLIDER_INFO_JS = """
(el) => {
  const box = el.closest('.knob')?.querySelector('input.knob-box')
    || el.closest('.slidernum')?.querySelector('input[type="number"]')
    || null;
  const label = el.getAttribute('aria-label') || el.closest('[data-control]')?.dataset.control
    || el.closest('[data-k]')?.dataset.k || '';
  return {value: el.value, min: el.min, max: el.max, step: el.step, label,
          hasBox: box !== null, boxValue: box ? box.value : null};
}
"""

BOX_JS = """
(el) => el.closest('.knob')?.querySelector('input.knob-box')
  || el.closest('.slidernum')?.querySelector('input[type="number"]')
"""

CARD_JS = "el => el.closest('[data-card]') || el.closest('.primer-graph') || el.parentElement"


@dataclass(frozen=True)
class PlotPass:
    """One plot pass's inputs beyond browser and viewport: URL, tabs, output directory, whether staging is refused."""

    url: str
    tabs: list[dict[str, str]]
    outdir: Path
    dirty: bool


def attach_console(page: Page, sink: list[dict[str, Any]]) -> None:
    """Record console errors, uncaught page errors and failed requests into ``sink`` in arrival order."""

    def on_console(msg: ConsoleMessage) -> None:
        if msg.type == "error":
            sink.append({"kind": "console", "text": msg.text, "location": msg.location})

    def on_pageerror(err: Error) -> None:
        sink.append({"kind": "pageerror", "text": err.message})

    def on_requestfailed(req: Request) -> None:
        sink.append({"kind": "requestfailed", "url": req.url, "method": req.method, "failure": req.failure})

    def on_response(res: Response) -> None:
        if res.status >= HTTP_ERROR_STATUS:
            sink.append({"kind": "httperror", "url": res.url, "method": res.request.method, "status": res.status})

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    page.on("requestfailed", on_requestfailed)
    page.on("response", on_response)


def _select_tab(page: Page, tab_id: str) -> None:
    page.click(f'.tab-nav button[data-testid="tab-{tab_id}"]')
    page.wait_for_timeout(SETTLE_MS)


def _crops(page: Page, outdir: Path, tab: str) -> int:
    """Write one element screenshot per visible SVG or canvas on the tab; return how many."""
    n = 0
    for el in page.query_selector_all("svg, canvas"):
        bb = el.bounding_box()
        if not bb or bb["width"] < 1 or bb["height"] < 1:
            continue
        el.screenshot(path=str(outdir / f"{tab}-{n}-crop.png"))
        n += 1
    return n


def _frame(page: Page, el: ElementHandle, outdir: Path, stem: str, index: int) -> dict[str, Any]:
    """Capture one slider frame: value, plot findings, axis texts, trace vertices, and a crop of the plot."""
    page.wait_for_timeout(SETTLE_MS)
    raw: dict[str, Any] = page.evaluate(PLOTS_JS)
    traces = {t["selector"]: t["vertices"] for svg in raw["svgs"] for t in svg["traces"]}
    card = el.evaluate_handle(CARD_JS).as_element()
    if card is not None:
        card.screenshot(path=str(outdir / f"{stem}-{index}-crop.png"))
    return {
        "value": el.evaluate("el => el.value"),
        "findings": derive_plots(raw),
        "axisTexts": page.evaluate(AXIS_TEXTS_JS),
        "traces": traces,
    }


def _press(page: Page, key: str, times: int) -> None:
    for _ in range(times):
        page.keyboard.press(key)


def _restore(page: Page, el: ElementHandle, info: dict[str, Any], floor: float, delta: float) -> str:
    """Put the slider back on its starting value and return the readback."""
    start = float(info["value"])
    if info["step"] in ("", "any") and info["hasBox"]:
        box = el.evaluate_handle(BOX_JS).as_element()
        if box is not None:
            box.fill(str(info["boxValue"]))
            box.press("Enter")
            page.wait_for_timeout(SETTLE_MS)
            got = box.evaluate("el => el.value")
            return f"box={got} (wanted {info['boxValue']})"
    _press(page, "Home", 1)
    _press(page, "ArrowRight", round((start - floor) / delta))
    got = el.evaluate("el => el.value")
    how = "" if info["step"] not in ("", "any") else " within one step, no box"
    return f"value={got} (wanted {info['value']}){how}"


def _step_slider(page: Page, el: ElementHandle, outdir: Path, stem: str) -> str:
    """Step one slider across its range by keyboard, write frames and deltas, restore it; return a report line."""
    info: dict[str, Any] = el.evaluate(SLIDER_INFO_JS)
    el.evaluate("el => el.focus()")
    _press(page, "Home", 1)
    floor = float(el.evaluate("el => el.value"))
    _press(page, "ArrowRight", 1)
    delta = float(el.evaluate("el => el.value")) - floor
    if delta <= 0:
        return f"{stem} {info['label']!r}: keys do not move it, uncovered"
    count = math.ceil((float(info["max"]) - floor) / delta)
    chunk = max(1, math.ceil(count / FRAMES))
    _press(page, "Home", 1)
    frames = [_frame(page, el, outdir, stem, 0)]
    while True:
        _press(page, "ArrowRight", chunk)
        frame = _frame(page, el, outdir, stem, len(frames))
        if frame["value"] == frames[-1]["value"]:
            break
        frames.append(frame)
    deltas = frame_deltas(frames)
    readback = _restore(page, el, info, floor, delta)
    (outdir / f"{stem}-frames.json").write_text(json.dumps({"slider": info, "frames": frames, "deltas": deltas}))
    jumps = [i + 1 for i, d in enumerate(deltas) if d["jump"]]
    return f"{stem} {info['label']!r}: delta={delta:g} frames={len(frames)} jumps={jumps} restored {readback}"


def _pass_tab(page: Page, plan: PlotPass, tab_id: str) -> None:
    """Crop every plot on one tab, then step its sliders unless staging is refused."""
    _select_tab(page, tab_id)
    crops = _crops(page, plan.outdir, tab_id)
    if plan.dirty:
        print(f"{tab_id}: crops={crops}; staged buffer is not empty: sliders not stepped, uncovered")
        return
    sliders = [s for s in page.query_selector_all('input[type="range"]') if s.is_visible() and s.is_enabled()]
    print(f"{tab_id}: crops={crops} sliders={len(sliders)}")
    for n, el in enumerate(sliders):
        print(" ", _step_slider(page, el, plan.outdir, f"{tab_id}-slider{n}"))


def slider_pass(browser: Browser, plan: PlotPass, viewport: tuple[int, int]) -> None:
    """Run the DPR 3 context: one crop per plot, every range slider stepped by keyboard, frames and deltas written."""
    context = browser.new_context(
        viewport={"width": viewport[0], "height": viewport[1]}, device_scale_factor=CROP_SCALE
    )
    page = context.new_page()
    console: list[dict[str, Any]] = []
    attach_console(page, console)
    try:
        page.goto(plan.url, wait_until="networkidle")
        page.wait_for_selector(".tab-nav button")
        for tab in plan.tabs:
            _pass_tab(page, plan, tab["id"])
        if console:
            print("plot pass console:", json.dumps(console))
    finally:
        context.close()
