"""``scripts/sweepplots.py`` folds a plot capture into findings and a slider sweep into per-frame deltas.

``derive_plots`` takes one state's capture, ``{"svgs": [...]}``, each SVG carrying its
box, its traces (vertex lists in CSS px, stroke width, shape-rendering) and its text
boxes, and returns findings ``{"kind", "selector", "value"}``. ``frame_deltas`` takes one
slider pass, a list of frames in slider order, and returns one delta per frame after the
first: whether the axis text changed, whether the vertex count changed, how far the
traces moved, and whether that move is a jump against the pass as a whole.

Every capture here is built by hand from the shapes above so the expected number can be
written down rather than computed: a 400-vertex trace across 1000 px is 0.4 vertices
per px, an alternating trace reverses at every interior vertex, two boxes at 0..50 and
40..90 overlap by 10 px. The module is loaded by path, the way the gate tests load
``scripts/gates/``: it lives at the repo root's ``scripts/`` and is not a package.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""


#: The script under test, found relative to this file rather than through an import.
SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "sweepplots.py"


@pytest.fixture
def sweepplots() -> ModuleType:
    spec = importlib.util.spec_from_file_location("sweepplots_under_test", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(f"no importable module at {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- capture builders -------------------------------------------------------


def box(left: float, top: float, right: float, bottom: float) -> dict[str, float]:
    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "width": right - left,
        "height": bottom - top,
    }


def trace(selector: str, vertices: list[list[float]]) -> dict[str, Any]:
    """A trace drawn the ordinary way: 1.5 px stroke, shape-rendering auto."""
    return {"selector": selector, "vertices": vertices, "strokeWidth": 1.5, "shapeRendering": "auto"}


def text(label: str, left: float, right: float, top: float = 10.0, bottom: float = 20.0) -> dict[str, Any]:
    return {"text": label, **box(left, top, right, bottom)}


def svg(
    selector: str,
    traces: list[dict[str, Any]],
    texts: list[dict[str, Any]] | None = None,
    width: float = 1000.0,
) -> dict[str, Any]:
    return {
        "selector": selector,
        "box": box(0.0, 0.0, width, 400.0),
        "shapeRendering": "auto",
        "traces": traces,
        "texts": texts or [],
    }


def even_xs(count: int, width: float) -> list[float]:
    """``count`` x positions spread evenly from 0 to ``width`` inclusive."""
    return [i * width / (count - 1) for i in range(count)]


def flat(count: int, width: float, y: float = 100.0) -> list[list[float]]:
    return [[x, y] for x in even_xs(count, width)]


def alternating(count: int, width: float, swing: float) -> list[list[float]]:
    """y toggles by ``swing`` on every vertex, so dy changes sign at each interior vertex."""
    return [[x, 100.0 + (swing if i % 2 else 0.0)] for i, x in enumerate(even_xs(count, width))]


def ramp(count: int, width: float, step: float) -> list[list[float]]:
    """y climbs by ``step`` per vertex: monotone, never a reversal."""
    return [[x, 100.0 + i * step] for i, x in enumerate(even_xs(count, width))]


def sweep(moves: list[float]) -> list[dict[str, Any]]:
    """One slider pass: frame ``k`` sits ``moves[k]`` px below frame ``k - 1``.

    ``moves[0]`` is the first frame's own offset and carries no delta; the pass has
    ``len(moves)`` frames.
    """
    frames: list[dict[str, Any]] = []
    y = 0.0
    for k, move in enumerate(moves):
        y += move
        frames.append(
            {
                "value": float(k),
                "axisTexts": ["0", "1k", "10k"],
                "traces": {"path:a": [[0.0, y], [50.0, y], [100.0, y]]},
            }
        )
    return frames


def jump_frames(deltas: list[dict[str, Any]]) -> set[int]:
    """Frame indices flagged ``jump``; delta ``j`` describes frame ``j + 1``."""
    return {j + 1 for j, delta in enumerate(deltas) if delta["jump"]}


# --- derive_plots -----------------------------------------------------------


def test_few_points_names_only_the_trace_whose_vertices_per_drawn_px_is_low(sweepplots: ModuleType) -> None:
    raw = {"svgs": [svg("svg:1", [trace("path:wide", flat(400, 1000.0)), trace("path:narrow", flat(400, 700.0))])]}
    assert sweepplots.derive_plots(raw) == [
        {"kind": "few-points", "selector": "path:wide", "value": pytest.approx(0.4)}
    ]


def test_hash_counts_dy_sign_reversals_per_100_px_and_ignores_a_monotone_trace_of_equal_density(
    sweepplots: ModuleType,
) -> None:
    raw = {
        "svgs": [
            svg(
                "svg:1",
                [trace("path:zigzag", alternating(600, 1000.0, 3.0)), trace("path:ramp", ramp(600, 1000.0, 0.1))],
            )
        ]
    }
    assert sweepplots.derive_plots(raw) == [{"kind": "hash", "selector": "path:zigzag", "value": pytest.approx(59.8)}]


def test_collision_names_only_the_overlapping_text_pair_within_one_svg(sweepplots: ModuleType) -> None:
    raw = {
        "svgs": [
            svg("svg:1", [], [text("A", 0.0, 50.0), text("B", 40.0, 90.0), text("C", 200.0, 250.0)]),
            svg("svg:2", [], [text("D", 40.0, 90.0)]),
        ]
    }
    assert sweepplots.derive_plots(raw) == [
        {"kind": "collision", "selector": "text:A + text:B", "value": pytest.approx(10.0)}
    ]


# --- frame_deltas -----------------------------------------------------------


def test_jump_fires_against_the_pass_median_with_a_floor(sweepplots: ModuleType) -> None:
    passes = [sweep([2, 2, 2, 20, 2]), sweep([0, 0, 0, 4, 0]), sweep([10, 10, 10, 20, 10])]
    assert [jump_frames(sweepplots.frame_deltas(frames)) for frames in passes] == [{3}, set(), set()]
