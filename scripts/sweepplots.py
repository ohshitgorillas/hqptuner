#!/usr/bin/env python3
"""The plot half of the visual sweep: derived plot findings, the slider pass, and 3x crops.

``scripts/sweep.py`` captures every static state at DPR 1 and folds each
state's plot capture through ``derive_plots`` into findings a reviewer can
quote as numbers. After the static sweep of a tab, ``slider_pass`` opens a
second browser context at ``device_scale_factor`` 3, crops every SVG and canvas
on the tab, and steps every visible enabled range slider across its whole range
by keyboard, writing a frame per step and the adjacent-frame deltas
``frame_deltas`` derives. Keyboard is the only path the app honours for a
slider that no pointer holds; a synthetic value write is reverted.

Findings (``kind``, ``selector``, ``value``):

- ``few-points``   vertices per px of drawn width under 0.5, on 3+ vertices
- ``long-segment`` a segment over 4 px whose neighbour turns more than 15 degrees
- ``hash``         direction reversals of dy per 100 px of width over 40
- ``aliased``      ``shape-rendering`` crispEdges or optimizeSpeed on 3+ vertices
- ``hairline``     computed stroke width under 1 CSS px
- ``collision``    two ``<text>`` boxes in one SVG overlapping, value the overlap width
- ``escape``       a ``<text>`` box outside its SVG's box, value the px outside
- ``blurry``       a canvas whose backing width is not its CSS width times DPR
- ``jump``         a slider frame whose plot moved more than the larger of 3x the
                   pass median displacement and 6 px

Outputs per tab: ``OUTDIR/<tab>-<n>-crop.png`` per plot, and per slider
``OUTDIR/<tab>-slider<n>-<frame>-crop.png`` plus ``OUTDIR/<tab>-slider<n>-frames.json``
holding every frame (value, findings, axis texts, trace vertices) and the deltas.
A slider is restored to its starting value: by press count on a numeric step,
through its number box on ``step="any"``; the readback is printed per slider.
"""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from itertools import pairwise
from typing import TYPE_CHECKING, Any

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
MIN_TRACE = 3
FEW_POINTS_PER_PX = 0.5
LONG_SEGMENT_PX = 4.0
TURN_DEG = 15.0
HASH_PER_100PX = 40.0
HAIRLINE_PX = 1.0
JUMP_FLOOR_PX = 6.0
JUMP_MEDIAN_FACTOR = 3.0
ALIASED = {"crispedges", "optimizespeed"}

# Per SVG: box, shape-rendering, traces as screen-space vertices, text boxes; per canvas: backing size.
PLOTS_JS = """
() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return {left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height};
  };
  const tag = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim()
      : (el.className && el.className.baseVal ? el.className.baseVal.trim() : '');
    return el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\\s+/).join('.') : '');
  };
  const toScreen = (el, pts) => {
    const m = el.getScreenCTM();
    if (!m) return [];
    return pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  };
  const pathVertices = (d) => {
    const out = [];
    let cmd = '';
    let cur = [0, 0];
    const tokens = (d || '').match(/[MLHVZmlhvz]|-?\\d*\\.?\\d+(?:e-?\\d+)?/g) || [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (/[A-Za-z]/.test(t)) { cmd = t; i += 1; continue; }
      if (cmd === 'M' || cmd === 'L') { cur = [Number(t), Number(tokens[i + 1])]; i += 2; }
      else if (cmd === 'H') { cur = [Number(t), cur[1]]; i += 1; }
      else if (cmd === 'V') { cur = [cur[0], Number(t)]; i += 1; }
      else { i += 1; continue; }
      out.push(cur);
    }
    return out;
  };
  const svgs = [];
  for (const svg of document.querySelectorAll('svg')) {
    const b = box(svg);
    if (!b.width || !b.height) continue;
    const traces = [];
    for (const el of svg.querySelectorAll('polyline, polygon, path')) {
      const raw = el.tagName.toLowerCase() === 'path'
        ? pathVertices(el.getAttribute('d'))
        : Array.from(el.points || []).map(p => [p.x, p.y]);
      const s = getComputedStyle(el);
      traces.push({selector: tag(el), vertices: toScreen(el, raw),
                   strokeWidth: parseFloat(s.strokeWidth) || 0,
                   shapeRendering: s.shapeRendering, stroke: s.stroke});
    }
    const texts = Array.from(svg.querySelectorAll('text')).map(t => ({
      text: (t.textContent || '').trim(), ...box(t)}));
    svgs.push({selector: tag(svg), box: b, shapeRendering: getComputedStyle(svg).shapeRendering,
               traces, texts});
  }
  const dpr = window.devicePixelRatio;
  const canvases = Array.from(document.querySelectorAll('canvas')).map(c => {
    const b = box(c);
    return {selector: tag(c), cssWidth: b.width, cssHeight: b.height,
            backingWidth: c.width, backingHeight: c.height, dpr};
  });
  return {svgs, canvases};
}
"""

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


def _finding(kind: str, selector: str, value: float) -> dict[str, Any]:
    return {"kind": kind, "selector": selector, "value": round(value, 3)}


def _segments(vertices: list[list[float]]) -> list[tuple[float, float, float]]:
    """Each segment as (dx, dy, length)."""
    out = []
    for (x0, y0), (x1, y1) in pairwise(vertices):
        dx, dy = x1 - x0, y1 - y0
        out.append((dx, dy, math.hypot(dx, dy)))
    return out


def _turn_deg(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    if not a[2] or not b[2]:
        return 0.0
    cos = (a[0] * b[0] + a[1] * b[1]) / (a[2] * b[2])
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _reversals(segments: list[tuple[float, float, float]]) -> int:
    """Count sign changes of dy between one segment and the next, zero dy carrying no sign."""
    count = 0
    last = 0
    for _, dy, _ in segments:
        sign = (dy > 0) - (dy < 0)
        if sign and last and sign != last:
            count += 1
        if sign:
            last = sign
    return count


def _trace_findings(trace: dict[str, Any], svg_rendering: str) -> list[dict[str, Any]]:
    """Derive one polyline, polygon or path's findings: few points, long segment, hash, aliased, hairline."""
    sel = str(trace["selector"])
    vertices: list[list[float]] = trace["vertices"]
    out: list[dict[str, Any]] = []
    stroke = float(trace.get("strokeWidth") or 0)
    if vertices and 0 < stroke < HAIRLINE_PX:
        out.append(_finding("hairline", sel, stroke))
    if len(vertices) < MIN_TRACE:
        return out
    rendering = str(trace.get("shapeRendering") or svg_rendering).lower()
    if rendering in ALIASED:
        out.append(_finding("aliased", sel, len(vertices)))
    xs = [v[0] for v in vertices]
    width = max(xs) - min(xs)
    if width <= 0:
        return out
    per_px = len(vertices) / width
    if per_px < FEW_POINTS_PER_PX:
        out.append(_finding("few-points", sel, per_px))
    segs = _segments(vertices)
    longest = _long_segment(segs)
    if longest:
        out.append(_finding("long-segment", sel, longest))
    per_100 = _reversals(segs) / width * 100
    if per_100 > HASH_PER_100PX:
        out.append(_finding("hash", sel, per_100))
    return out


def _long_segment(segs: list[tuple[float, float, float]]) -> float:
    """Return the longest segment over the cap whose neighbour turns past the angle, else 0."""
    worst = 0.0
    for i, seg in enumerate(segs):
        if seg[2] <= LONG_SEGMENT_PX:
            continue
        before = _turn_deg(segs[i - 1], seg) if i > 0 else 0.0
        after = _turn_deg(seg, segs[i + 1]) if i + 1 < len(segs) else 0.0
        if max(before, after) > TURN_DEG:
            worst = max(worst, seg[2])
    return worst


def _overlap(a: dict[str, Any], b: dict[str, Any]) -> tuple[float, float]:
    ow = min(a["right"], b["right"]) - max(a["left"], b["left"])
    oh = min(a["bottom"], b["bottom"]) - max(a["top"], b["top"])
    return ow, oh


def _outside(box: dict[str, Any], a: dict[str, Any]) -> float:
    edges = (box["left"] - a["left"], a["right"] - box["right"], box["top"] - a["top"], a["bottom"] - box["bottom"])
    return float(max(edges))


def _text_findings(svg: dict[str, Any]) -> list[dict[str, Any]]:
    """Derive collisions between text boxes of one SVG, and text boxes escaping the SVG's box."""
    out: list[dict[str, Any]] = []
    texts: list[dict[str, Any]] = svg["texts"]
    for i, a in enumerate(texts):
        for b in texts[i + 1 :]:
            ow, oh = _overlap(a, b)
            if ow > 0 and oh > 0:
                out.append(_finding("collision", f"text:{a['text']} + text:{b['text']}", ow))
        outside = _outside(svg["box"], a)
        if outside > 0:
            out.append(_finding("escape", f"text:{a['text']}", outside))
    return out


def derive_plots(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Fold one state's plot capture into findings: kind, selector, value."""
    out: list[dict[str, Any]] = []
    for svg in raw.get("svgs", []):
        rendering = str(svg.get("shapeRendering") or "")
        for trace in svg.get("traces", []):
            out.extend(_trace_findings(trace, rendering))
        out.extend(_text_findings(svg))
    for canvas in raw.get("canvases", []):
        expected = canvas["cssWidth"] * canvas["dpr"]
        if canvas["cssWidth"] and abs(canvas["backingWidth"] - expected) > 1:
            out.append(_finding("blurry", str(canvas["selector"]), canvas["backingWidth"] / expected))
    return out


def _displacement(prev: dict[str, list[list[float]]], cur: dict[str, list[list[float]]]) -> float:
    worst = 0.0
    for sel, verts in cur.items():
        before = prev.get(sel)
        if before is None or len(before) != len(verts):
            continue
        for (x0, y0), (x1, y1) in zip(before, verts, strict=True):
            worst = max(worst, math.hypot(x1 - x0, y1 - y0))
    return worst


def frame_deltas(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Derive per frame after the first: axisChanged, vertexCountChanged, displacement px, jump."""
    out: list[dict[str, Any]] = []
    for prev, cur in pairwise(frames):
        pt, ct = prev["traces"], cur["traces"]
        counts_differ = set(pt) != set(ct) or any(len(pt[s]) != len(ct[s]) for s in ct if s in pt)
        out.append(
            {
                "axisChanged": set(prev["axisTexts"]) != set(cur["axisTexts"]),
                "vertexCountChanged": counts_differ,
                "displacement": round(_displacement(pt, ct), 3),
                "jump": False,
            }
        )
    if out:
        median = statistics.median(d["displacement"] for d in out)
        threshold = max(JUMP_MEDIAN_FACTOR * median, JUMP_FLOOR_PX)
        for d in out:
            d["jump"] = d["displacement"] > threshold
    return out


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
