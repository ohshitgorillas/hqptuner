"""``scripts/sweepplots.py`` folds a plot capture into findings and a slider sweep into per-frame deltas.

``derive_plots`` takes one state's capture, ``{"svgs": [...]}``, each SVG carrying its
box, its traces (vertex lists in page coordinates, CSS px, stroke width, shape-rendering) and its text
boxes, and returns findings ``{"kind", "selector", "value"}``. ``frame_deltas`` takes one
slider pass, a list of frames in slider order, and returns one delta per frame after the
first: whether the axis text changed, whether the vertex count changed, how far the
traces moved, and whether that move is a jump against the pass as a whole.

Every capture here is built by hand from the shapes above so the expected number can be
written down rather than computed: a 400-vertex trace across 1000 px is 0.4 vertices
per px, two boxes at 0..50 and 40..90 overlap by 10 px. The module is loaded by path, the way the gate tests load
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
    clip: dict[str, float] | None = None,
) -> dict[str, Any]:
    """``clip`` is the clip rectangle's box when the SVG clips its traces, else ``None``."""
    return {
        "selector": selector,
        "box": box(0.0, 0.0, width, 400.0),
        "clip": clip,
        "shapeRendering": "auto",
        "traces": traces,
        "texts": texts or [],
    }


def even_xs(count: int, width: float) -> list[float]:
    """``count`` x positions spread evenly from 0 to ``width`` inclusive."""
    return [i * width / (count - 1) for i in range(count)]


def flat(count: int, width: float, y: float = 100.0) -> list[list[float]]:
    return [[x, y] for x in even_xs(count, width)]


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


def of_kind(findings: list[dict[str, Any]], kind: str) -> list[tuple[str, Any]]:
    """``(selector, value)`` of every finding of ``kind``, sorted by selector so order is not pinned."""
    return sorted((f["selector"], f["value"]) for f in findings if f["kind"] == kind)


def jump_frames(deltas: list[dict[str, Any]]) -> set[int]:
    """Frame indices flagged ``jump``; delta ``j`` describes frame ``j + 1``."""
    return {j + 1 for j, delta in enumerate(deltas) if delta["jump"]}


# --- derive_plots -----------------------------------------------------------


def test_few_points_names_only_the_trace_whose_vertices_per_drawn_px_is_low(sweepplots: ModuleType) -> None:
    raw = {"svgs": [svg("svg:1", [trace("path:wide", flat(400, 1000.0)), trace("path:narrow", flat(400, 700.0))])]}
    assert sweepplots.derive_plots(raw) == [
        {"kind": "few-points", "selector": "path:wide", "value": pytest.approx(0.4)}
    ]


def test_hash_reports_the_densest_100_px_stretch_of_a_trace_not_its_whole_width_average(
    sweepplots: ModuleType,
) -> None:
    # 501 vertices at 2 px spacing. ``mid`` toggles y on every vertex from x 402 to 600 only:
    # 100 non-zero segments there, so 99 reversals inside 200 px (about 50 per 100 px), and
    # about 10 per 100 px averaged over the full 1000 px. ``spread`` flips y every fifth
    # vertex across the whole width: one reversal per 10 px everywhere, 10 per 100 px.
    mid = [[x, 103.0 if 402.0 <= x <= 600.0 and i % 2 else 100.0] for i, x in enumerate(even_xs(501, 1000.0))]
    spread = [[x, 103.0 if (i // 5) % 2 else 100.0] for i, x in enumerate(even_xs(501, 1000.0))]
    raw = {"svgs": [svg("svg:1", [trace("path:mid", mid), trace("path:spread", spread)])]}
    assert of_kind(sweepplots.derive_plots(raw), "hash") == [("path:mid", pytest.approx(50.0, abs=2.0))]


def test_narrow_measures_the_px_width_of_the_trace_above_half_level_following_segments_to_the_crossings(
    sweepplots: ModuleType,
) -> None:
    # 2001 vertices at 0.5 px spacing, median y 100, farthest point y 0, so the half level is
    # y 50. The lone x 100 vertex at y 60 never reaches it on either trace. ``spike`` holds y 0
    # at x 499.5 and 500: its segments cross y 50 at x 499.25 and 500.25, a width of 1 px,
    # not the 0.5 px between the two vertices. ``bump`` holds y 0 at x 496..504: crossings at
    # x 495.75 and 504.25, 8.5 px wide.
    spike = [[x, 0.0 if 499.5 <= x <= 500.0 else 60.0 if x == 100.0 else 100.0] for x in even_xs(2001, 1000.0)]
    bump = [[x, 0.0 if 496.0 <= x <= 504.0 else 60.0 if x == 100.0 else 100.0] for x in even_xs(2001, 1000.0)]
    raw = {"svgs": [svg("svg:1", [trace("path:spike", spike), trace("path:bump", bump)])]}
    assert of_kind(sweepplots.derive_plots(raw), "narrow") == [("path:spike", pytest.approx(1.0))]


def test_sparse_reports_the_vertex_count_of_a_three_to_five_vertex_trace(sweepplots: ModuleType) -> None:
    raw = {
        "svgs": [
            svg(
                "svg:1",
                [
                    trace("path:three", flat(3, 100.0)),
                    trace("path:five", flat(5, 100.0)),
                    trace("path:six", flat(6, 100.0)),
                ],
            )
        ]
    }
    assert of_kind(sweepplots.derive_plots(raw), "sparse") == [
        ("path:five", pytest.approx(5)),
        ("path:three", pytest.approx(3)),
    ]


def test_escape_measures_against_the_clip_rectangle_when_present_else_the_svg_box(
    sweepplots: ModuleType,
) -> None:
    # Both SVG boxes span y 0..400. ``clipped`` has a clip spanning y 50..350 and one vertex
    # at y 20: 30 px above the clip, inside the box. ``open`` has no clip and one vertex at
    # y -10: 10 px above the box.
    clipped = [[x, 20.0 if x == 500.0 else 100.0] for x in even_xs(501, 1000.0)]
    unclipped = [[x, -10.0 if x == 500.0 else 100.0] for x in even_xs(501, 1000.0)]
    raw = {
        "svgs": [
            svg("svg:1", [trace("path:clipped", clipped)], clip=box(0.0, 50.0, 1000.0, 350.0)),
            svg("svg:2", [trace("path:open", unclipped)], clip=None),
        ]
    }
    assert of_kind(sweepplots.derive_plots(raw), "escape") == [
        ("path:clipped", pytest.approx(30.0)),
        ("path:open", pytest.approx(10.0)),
    ]


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
