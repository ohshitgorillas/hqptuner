#!/usr/bin/env python3
"""Derived plot findings for the visual sweep: the browser capture and the numbers folded out of it.

``PLOTS_JS`` captures every SVG on the page (box, clip rectangle when it has
one, ``shape-rendering``, traces as vertices in page coordinates with stroke
width, text boxes) and every canvas (CSS size, backing size, DPR). Boxes and
vertices are page coordinates, CSS px, so a capture reads the same wherever
the page is scrolled. ``derive_plots``
folds one such capture into findings, and ``frame_deltas`` folds one slider
pass's frames into adjacent-frame deltas. ``scripts/sweep.py`` runs the first
on every static state, ``scripts/sweepslide.py`` runs both per slider frame
and the first per corner state.

Findings (``kind``, ``selector``, ``value``):

- ``few-points``   vertices per px of drawn width under 0.5, on 3+ vertices
- ``long-segment`` a segment over 4 px whose neighbour turns more than 15 degrees
- ``hash``         direction reversals of dy inside the densest 100 px stretch
                   of the trace, over 30
- ``narrow``       px width of the drawn line where it stands more than halfway
                   from the trace's median y to its farthest point, following
                   each segment to where it crosses that level, under 4 px: a
                   feature drawn as a needle
- ``sparse``       a trace of 3 to 5 vertices, value the vertex count
- ``aliased``      ``shape-rendering`` crispEdges or optimizeSpeed on 3+ vertices
- ``hairline``     computed stroke width under 1 CSS px
- ``collision``    two ``<text>`` boxes in one SVG overlapping, value the overlap width
- ``escape``       a ``<text>`` box outside its SVG's box, or a trace vertex
                   outside the SVG's clip rectangle (its box when it has no
                   clip), value the px outside
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
HASH_PER_100PX = 30.0
HASH_WINDOW_PX = 100.0
NARROW_PX = 4.0
SPARSE_MAX = 5
HAIRLINE_PX = 1.0
# A vertex this far past the clip is sub-pixel rounding of a point drawn on the edge.
ESCAPE_EPS_PX = 0.5
JUMP_FLOOR_PX = 6.0
JUMP_MEDIAN_FACTOR = 3.0
ALIASED = {"crispedges", "optimizespeed"}

# Per SVG: box, clip rect, shape-rendering, traces as page-coordinate vertices, text boxes; per canvas: backing size.
PLOTS_JS = """
() => {
  // Page coordinates: an element screenshot between two captures scrolls the
  // page, and viewport coordinates would move every vertex with it.
  const sx = window.scrollX, sy = window.scrollY;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return {left: r.left + sx, top: r.top + sy, right: r.right + sx, bottom: r.bottom + sy,
            width: r.width, height: r.height};
  };
  const tag = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim()
      : (el.className && el.className.baseVal ? el.className.baseVal.trim() : '');
    return el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\\s+/).join('.') : '');
  };
  const toScreen = (el, pts) => {
    const m = el.getScreenCTM();
    if (!m) return [];
    return pts.map(([x, y]) => [m.a * x + m.c * y + m.e + sx, m.b * x + m.d * y + m.f + sy]);
  };
  // A clipPath's content is never rendered and has no CTM of its own, so the
  // rect's attributes are mapped through the SVG's CTM instead.
  const clipBox = (svg) => {
    const rect = svg.querySelector('clipPath rect');
    const m = svg.getScreenCTM();
    if (!rect || !m) return null;
    const x = Number(rect.getAttribute('x') || 0), y = Number(rect.getAttribute('y') || 0);
    const w = Number(rect.getAttribute('width') || 0), h = Number(rect.getAttribute('height') || 0);
    const [[left, top], [right, bottom]] = toScreen(svg, [[x, y], [x + w, y + h]]);
    return {left, top, right, bottom, width: right - left, height: bottom - top};
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
      if (el.closest('clipPath')) continue;
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
    svgs.push({selector: tag(svg), box: b, clip: clipBox(svg),
               shapeRendering: getComputedStyle(svg).shapeRendering, traces, texts});
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


def _reversal_xs(vertices: list[list[float]]) -> list[float]:
    """List the x of every vertex at which dy changes sign from the segment before, zero dy carrying no sign."""
    out: list[float] = []
    last = 0
    for (_, y0), (x1, y1) in pairwise(vertices):
        dy = y1 - y0
        sign = (dy > 0) - (dy < 0)
        if sign and last and sign != last:
            out.append(x1)
        if sign:
            last = sign
    return out


def _hash(vertices: list[list[float]]) -> int:
    """Reversals inside the densest window of ``HASH_WINDOW_PX`` along the trace."""
    xs = sorted(_reversal_xs(vertices))
    worst = 0
    start = 0
    for end, x in enumerate(xs):
        while x - xs[start] > HASH_WINDOW_PX:
            start += 1
        worst = max(worst, end - start + 1)
    return worst


def _crossing(a: list[float], b: list[float], level: float) -> float:
    """Return the x at which the segment from ``a`` to ``b`` crosses ``level`` in departure."""
    return a[0] + (b[0] - a[0]) * (level - a[2]) / (b[2] - a[2])


def _narrow(vertices: list[list[float]]) -> float | None:
    """Px width of the drawn line where it stands more than halfway from the median y to its farthest point."""
    median = statistics.median(v[1] for v in vertices)
    marked = [[v[0], v[1], abs(v[1] - median)] for v in vertices]
    peak = max(m[2] for m in marked)
    if peak <= 0:
        return None
    half = peak / 2
    xs: list[float] = [m[0] for m in marked if m[2] > half]
    for a, b in pairwise(marked):
        if (a[2] > half) != (b[2] > half):
            xs.append(_crossing(a, b, half))
    return max(xs) - min(xs)


def _outside(box: dict[str, Any], a: dict[str, Any]) -> float:
    edges = (box["left"] - a["left"], a["right"] - box["right"], box["top"] - a["top"], a["bottom"] - box["bottom"])
    return float(max(edges))


def _escape(bounds: dict[str, Any], vertices: list[list[float]]) -> float:
    """Px the farthest vertex sits outside ``bounds``."""
    worst = 0.0
    for x, y in vertices:
        worst = max(worst, _outside(bounds, {"left": x, "right": x, "top": y, "bottom": y}))
    return worst


def _shape_findings(sel: str, vertices: list[list[float]], width: float) -> list[dict[str, Any]]:
    """Derive the findings read off a trace's vertices alone: few points, sparse, long segment, hash, narrow."""
    out: list[dict[str, Any]] = []
    per_px = len(vertices) / width
    if per_px < FEW_POINTS_PER_PX:
        out.append(_finding("few-points", sel, per_px))
    if len(vertices) <= SPARSE_MAX:
        out.append(_finding("sparse", sel, len(vertices)))
    longest = _long_segment(_segments(vertices))
    if longest:
        out.append(_finding("long-segment", sel, longest))
    dense = _hash(vertices)
    if dense > HASH_PER_100PX:
        out.append(_finding("hash", sel, dense))
    span = _narrow(vertices)
    if span is not None and span < NARROW_PX:
        out.append(_finding("narrow", sel, span))
    return out


def _trace_findings(trace: dict[str, Any], svg_rendering: str, bounds: dict[str, Any]) -> list[dict[str, Any]]:
    """Derive one polyline, polygon or path's findings, ``bounds`` being the box its vertices must stay inside."""
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
    out.extend(_shape_findings(sel, vertices, width))
    outside = _escape(bounds, vertices)
    if outside > ESCAPE_EPS_PX:
        out.append(_finding("escape", sel, outside))
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
        bounds: dict[str, Any] = svg.get("clip") or svg["box"]
        for trace in svg.get("traces", []):
            out.extend(_trace_findings(trace, rendering, bounds))
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
