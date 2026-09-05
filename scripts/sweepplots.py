#!/usr/bin/env python3
"""Derived plot findings for the visual sweep: the browser capture and the numbers folded out of it.

``PLOTS_JS`` captures every SVG on the page (box, ``shape-rendering``, traces
as screen-space vertices with stroke width, text boxes) and every canvas
(CSS size, backing size, DPR). ``derive_plots`` folds one such capture into
findings, and ``frame_deltas`` folds one slider pass's frames into
adjacent-frame deltas. ``scripts/sweep.py`` runs the first on every static
state, ``scripts/sweepslide.py`` runs both per slider frame.

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
"""

from __future__ import annotations

import math
import statistics
from itertools import pairwise
from typing import Any

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
