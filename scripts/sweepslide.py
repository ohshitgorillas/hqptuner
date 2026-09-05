#!/usr/bin/env python3
"""The plot pass of the visual sweep: 3x crops, every range slider stepped by keyboard, slider corners, frame deltas.

``slider_pass`` opens a second browser context at ``device_scale_factor`` 3,
and per tab crops every SVG and canvas, then steps every visible enabled range
slider across its whole range by keyboard, writing a frame per step and the
adjacent-frame deltas ``scripts/sweepplots.py`` derives, then captures every
combination of the tab's sliders at their minimum and maximum (its corners).
Keyboard is the only path the app honours for a slider that no pointer holds;
a synthetic value write is reverted.

Outputs per tab: ``OUTDIR/<tab>-<n>-crop.png`` per plot; per slider
``OUTDIR/<tab>-slider<n>-<frame>-<p>-crop.png`` per plot in the slider's card
plus ``OUTDIR/<tab>-slider<n>-frames.json`` holding every frame (value,
findings, axis texts, trace vertices keyed ``svg<i>/<selector>``) and the
deltas; and ``OUTDIR/<tab>-corners.json`` holding one frame per corner state
(the value of every slider, findings, axis texts, traces) with
``OUTDIR/<tab>-corner<i>-<p>-crop.png`` per plot. Up to four sliders make
corners, sixteen states; further sliders stay where they started. Every
slider is restored to its starting value: by press count on a numeric step,
through its number box on ``step="any"``; the readback is printed per slider
and again after the corners.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from itertools import product
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
# Sliders combined into corner states; 2 to this power states.
CORNER_SLIDERS = 4

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


@dataclass(frozen=True)
class Slider:
    """One range slider as the keyboard sees it: its element, its start state, its floor and its key step."""

    el: ElementHandle
    info: dict[str, Any]
    floor: float
    delta: float


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


def _crops(root: Page | ElementHandle, outdir: Path, stem: str) -> int:
    """Write one element screenshot per visible SVG or canvas under ``root``; return how many."""
    n = 0
    for el in root.query_selector_all("svg, canvas"):
        bb = el.bounding_box()
        if not bb or bb["width"] < 1 or bb["height"] < 1:
            continue
        el.screenshot(path=str(outdir / f"{stem}-{n}-crop.png"))
        n += 1
    return n


def _capture(page: Page, card: ElementHandle | None, outdir: Path, stem: str) -> dict[str, Any]:
    """Capture one plot state: findings, axis texts, trace vertices keyed by SVG, and a crop per plot in the card."""
    page.wait_for_timeout(SETTLE_MS)
    raw: dict[str, Any] = page.evaluate(PLOTS_JS)
    traces = {f"svg{i}/{t['selector']}": t["vertices"] for i, svg in enumerate(raw["svgs"]) for t in svg["traces"]}
    if card is not None:
        _crops(card, outdir, stem)
    return {"findings": derive_plots(raw), "axisTexts": page.evaluate(AXIS_TEXTS_JS), "traces": traces}


def _card(el: ElementHandle) -> ElementHandle | None:
    return el.evaluate_handle(CARD_JS).as_element()


def _frame(page: Page, el: ElementHandle, outdir: Path, stem: str, index: int) -> dict[str, Any]:
    """Capture one slider frame: the slider's value plus the plot state."""
    return {"value": el.evaluate("el => el.value"), **_capture(page, _card(el), outdir, f"{stem}-{index}")}


def _press(page: Page, key: str, times: int) -> None:
    for _ in range(times):
        page.keyboard.press(key)


def _restore(page: Page, slider: Slider) -> str:
    """Put the slider back on its starting value and return the readback."""
    el, info = slider.el, slider.info
    start = float(info["value"])
    if info["step"] in ("", "any") and info["hasBox"]:
        box = el.evaluate_handle(BOX_JS).as_element()
        if box is not None:
            box.fill(str(info["boxValue"]))
            box.press("Enter")
            page.wait_for_timeout(SETTLE_MS)
            got = box.evaluate("el => el.value")
            return f"box={got} (wanted {info['boxValue']})"
    el.evaluate("el => el.focus()")
    _press(page, "Home", 1)
    _press(page, "ArrowRight", round((start - slider.floor) / slider.delta))
    got = el.evaluate("el => el.value")
    how = "" if info["step"] not in ("", "any") else " within one step, no box"
    return f"value={got} (wanted {info['value']}){how}"


def _probe(page: Page, el: ElementHandle) -> Slider:
    """Read a slider's start state, then its floor and the value one key press adds; leaves it one step up."""
    info: dict[str, Any] = el.evaluate(SLIDER_INFO_JS)
    el.evaluate("el => el.focus()")
    _press(page, "Home", 1)
    floor = float(el.evaluate("el => el.value"))
    _press(page, "ArrowRight", 1)
    delta = float(el.evaluate("el => el.value")) - floor
    return Slider(el=el, info=info, floor=floor, delta=delta)


def _step_slider(page: Page, el: ElementHandle, outdir: Path, stem: str) -> str:
    """Step one slider across its range by keyboard, write frames and deltas, restore it; return a report line."""
    slider = _probe(page, el)
    info = slider.info
    if slider.delta <= 0:
        return f"{stem} {info['label']!r}: keys do not move it, uncovered"
    count = math.ceil((float(info["max"]) - slider.floor) / slider.delta)
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
    readback = _restore(page, slider)
    (outdir / f"{stem}-frames.json").write_text(json.dumps({"slider": info, "frames": frames, "deltas": deltas}))
    jumps = [i + 1 for i, d in enumerate(deltas) if d["jump"]]
    return f"{stem} {info['label']!r}: delta={slider.delta:g} frames={len(frames)} jumps={jumps} restored {readback}"


def _corner_frames(page: Page, movable: list[Slider], outdir: Path, tab_id: str) -> list[dict[str, Any]]:
    """Put the sliders on every min/max combination in turn and capture each: slider values plus the plot state."""
    frames: list[dict[str, Any]] = []
    card = _card(movable[0].el)
    for bits in product((False, True), repeat=len(movable)):
        for slider, high in zip(movable, bits, strict=True):
            slider.el.evaluate("el => el.focus()")
            _press(page, "End" if high else "Home", 1)
        state = _capture(page, card, outdir, f"{tab_id}-corner{len(frames)}")
        values = {s.info["label"]: s.el.evaluate("el => el.value") for s in movable}
        frames.append({"values": values, **state})
    return frames


def _corners(page: Page, sliders: list[ElementHandle], outdir: Path, tab_id: str) -> str:
    """Capture every min/max combination of the first sliders on the tab, restore them; return a report line."""
    probed = [_probe(page, el) for el in sliders[:CORNER_SLIDERS]]
    movable = [s for s in probed if s.delta > 0]
    for slider in probed:
        _restore(page, slider)
    if not movable:
        return f"{tab_id} corners: no slider keys can move, uncovered"
    frames = _corner_frames(page, movable, outdir, tab_id)
    readbacks = ", ".join(f"{s.info['label']!r} {_restore(page, s)}" for s in movable)
    (outdir / f"{tab_id}-corners.json").write_text(json.dumps({"sliders": [s.info for s in movable], "frames": frames}))
    left = len(sliders) - len(probed)
    rest = f"; {left} further slider(s) left at start" if left > 0 else ""
    return f"{tab_id} corners: {len(frames)} states over {len(movable)} slider(s){rest}; restored {readbacks}"


def _pass_tab(page: Page, plan: PlotPass, tab_id: str) -> None:
    """Crop every plot on one tab, then step its sliders and its corners unless staging is refused."""
    _select_tab(page, tab_id)
    crops = _crops(page, plan.outdir, tab_id)
    if plan.dirty:
        print(f"{tab_id}: crops={crops}; staged buffer is not empty: sliders not stepped, corners not taken, uncovered")
        return
    sliders = [s for s in page.query_selector_all('input[type="range"]') if s.is_visible() and s.is_enabled()]
    print(f"{tab_id}: crops={crops} sliders={len(sliders)}")
    for n, el in enumerate(sliders):
        print(" ", _step_slider(page, el, plan.outdir, f"{tab_id}-slider{n}"))
    if sliders:
        print(" ", _corners(page, sliders, plan.outdir, tab_id))


def slider_pass(browser: Browser, plan: PlotPass, viewport: tuple[int, int]) -> None:
    """Run the DPR 3 context: one crop per plot, every range slider stepped by keyboard, corners, frames and deltas."""
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
