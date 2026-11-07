"""Numeric limits require complete, current evidence from their daemon source."""

from functools import partial
from typing import Literal

import pytest

from hqptuner.conf.formparse import parse_config_form, parse_matrix_form
from hqptuner.core.fieldvalues import Bounds, bounds_of
from hqptuner.core.readings import Readings
from hqptuner.fields import query
from hqptuner.fields.model import Field

GENERATION = 7
NEXT_GENERATION = 8
Constraint = Literal["min", "max", "step"]
LIMITS = ("min", "max", "step")
FORM_LIMITS = '<input type="number" name="gain_comp" min="-13.5" max="7.25" step="0.125">'
OTHER_LIMITS = '<input type="number" name="channels" min="3" max="19" step="2">'
RANGE = {"min": "-61.5", "max": "4.25", "step": "0.25"}


def take_form(readings: Readings, html: str, generation: int = GENERATION) -> None:
    readings.take_file(
        generation=generation,
        config_form=parse_config_form(f'<form method="post">{html}</form>'),
    )


def record_bounds(heard: list[Bounds | None], readings: Readings, row: Field) -> None:
    heard.append(bounds_of(readings, row))


# Break: return defaults or take a different field's constraints from the same form.
@pytest.mark.parametrize(
    ("name", "constraint", "expected"),
    [
        ("gain_comp", "min", -13.5),
        ("gain_comp", "max", 7.25),
        ("gain_comp", "step", 0.125),
        ("channels", "min", 3),
        ("channels", "max", 19),
        ("channels", "step", 2),
    ],
)
def test_form_bounds_use_the_selected_daemon_field(name: str, constraint: Constraint, expected: float) -> None:
    readings = Readings()
    take_form(readings, OTHER_LIMITS + FORM_LIMITS)
    row = query.field(name)
    assert row is not None
    bounds = bounds_of(readings, row)
    assert bounds is not None
    assert bounds[constraint] == expected


# Break: keep earlier limits after a successful daemon reread changes them.
@pytest.mark.parametrize("maximum", [9.5, 21.75])
def test_form_reread_replaces_the_reported_limit(maximum: float) -> None:
    readings = Readings()
    take_form(readings, FORM_LIMITS)
    take_form(readings, FORM_LIMITS.replace('max="7.25"', f'max="{maximum}"'))
    row = query.field("gain_comp")
    assert row is not None
    bounds = bounds_of(readings, row)
    assert bounds is not None
    assert bounds["max"] == maximum


# Break: use form or hard-coded volume limits instead of VolumeRange evidence.
@pytest.mark.parametrize(
    ("wire", "constraint", "expected"),
    [
        (RANGE, "min", -61.5),
        (RANGE, "max", 4.25),
        (RANGE, "step", 0.25),
        ({"min": "-39", "max": "2", "step": "0.5"}, "min", -39),
        ({"min": "-39", "max": "2", "step": "0.5"}, "max", 2),
        ({"min": "-39", "max": "2", "step": "0.5"}, "step", 0.5),
    ],
)
def test_volume_bounds_use_the_reported_range(wire: dict[str, str], constraint: Constraint, expected: float) -> None:
    readings = Readings()
    readings.take_engine(GENERATION, volume_range=wire)
    take_form(readings, FORM_LIMITS.replace("gain_comp", "volume"))
    row = query.field("volume")
    assert row is not None
    bounds = bounds_of(readings, row)
    assert bounds is not None
    assert bounds[constraint] == expected


# Break: fill a missing daemon constraint with a default or retained limit.
@pytest.mark.parametrize("missing", LIMITS)
def test_incomplete_form_evidence_withholds_previously_available_bounds(missing: str) -> None:
    readings = Readings()
    take_form(readings, FORM_LIMITS)
    row = query.field("gain_comp")
    assert row is not None
    before = bounds_of(readings, row)
    take_form(readings, FORM_LIMITS.replace(f'{missing}="', f'data-{missing}="'))
    assert (before, bounds_of(readings, row)) == ({"min": -13.5, "max": 7.25, "step": 0.125}, None)


# Break: infer a volume step or retain an earlier missing range component.
@pytest.mark.parametrize("missing", LIMITS)
def test_incomplete_volume_evidence_withholds_previously_available_bounds(missing: str) -> None:
    readings = Readings()
    readings.take_engine(GENERATION, volume_range=RANGE)
    row = query.field("volume")
    assert row is not None
    before = bounds_of(readings, row)
    readings.take_engine(GENERATION, volume_range={key: value for key, value in RANGE.items() if key != missing})
    assert (before, bounds_of(readings, row)) == ({"min": -61.5, "max": 4.25, "step": 0.25}, None)


# Break: serve held volume limits after the current Engine view is broken.
def test_engine_break_withholds_last_known_volume_bounds() -> None:
    readings = Readings()
    readings.take_engine(GENERATION, volume_range=RANGE)
    row = query.field("volume")
    assert row is not None
    before = bounds_of(readings, row)
    readings.break_engine()
    assert (before, bounds_of(readings, row)) == ({"min": -61.5, "max": 4.25, "step": 0.25}, None)


# Break: treat retained range evidence as current after a partial next-generation read.
def test_new_engine_generation_withholds_unrenewed_volume_bounds() -> None:
    readings = Readings()
    readings.take_engine(GENERATION, volume_range=RANGE)
    row = query.field("volume")
    assert row is not None
    before = bounds_of(readings, row)
    readings.take_engine(NEXT_GENERATION, state={"state": "0"})
    assert (before, bounds_of(readings, row)) == ({"min": -61.5, "max": 4.25, "step": 0.25}, None)


# Break: invent limits for a numeric row whose descriptor has no daemon source.
@pytest.mark.parametrize("name", ["nblocks", "cuda_dev", "backend"])
def test_unrelated_form_constraints_cannot_supply_an_unbounded_descriptor(name: str) -> None:
    readings = Readings()
    take_form(readings, FORM_LIMITS + FORM_LIMITS.replace("gain_comp", name))
    bounded = query.field("gain_comp")
    row = query.field(name)
    assert bounded is not None
    assert row is not None
    assert (bounds_of(readings, bounded), bounds_of(readings, row)) == (
        {"min": -13.5, "max": 7.25, "step": 0.125},
        None,
    )


# Break: expose retained form limits after their source is invalidated.
def test_file_invalidation_withholds_last_known_form_bounds() -> None:
    readings = Readings()
    take_form(readings, FORM_LIMITS)
    row = query.field("gain_comp")
    assert row is not None
    before = bounds_of(readings, row)
    readings.break_file("config_form")
    assert (before, bounds_of(readings, row)) == ({"min": -13.5, "max": 7.25, "step": 0.125}, None)


# Break: consider a prior Engine generation's form limits current without rereading.
def test_new_engine_generation_withholds_unrenewed_form_bounds() -> None:
    readings = Readings()
    readings.take_engine(GENERATION, state={"state": "0"})
    take_form(readings, FORM_LIMITS)
    row = query.field("gain_comp")
    assert row is not None
    before = bounds_of(readings, row)
    readings.take_engine(NEXT_GENERATION, state={"state": "0"})
    assert (before, bounds_of(readings, row)) == ({"min": -13.5, "max": 7.25, "step": 0.125}, None)


# Break: keep limits permanently unavailable after retiring a File source.
@pytest.mark.parametrize("maximum", [9.5, 21.75])
def test_fresh_form_evidence_restores_bounds_after_invalidation(maximum: float) -> None:
    readings = Readings()
    take_form(readings, FORM_LIMITS)
    readings.break_file("config_form")
    readings.take_engine(NEXT_GENERATION, state={"state": "0"})
    take_form(readings, FORM_LIMITS.replace('max="7.25"', f'max="{maximum}"'), NEXT_GENERATION)
    row = query.field("gain_comp")
    assert row is not None
    bounds = bounds_of(readings, row)
    assert bounds is not None
    assert bounds["max"] == maximum


# Break: supply limits before the daemon reports them.
@pytest.mark.parametrize("name", ["gain_comp", "volume"])
def test_numeric_bounds_wait_for_their_first_complete_report(name: str) -> None:
    readings = Readings()
    row = query.field(name)
    assert row is not None
    before = bounds_of(readings, row)
    take_form(readings, FORM_LIMITS)
    readings.take_engine(GENERATION, volume_range=RANGE)
    assert before != bounds_of(readings, row)


# Break: use the config form's same-named field instead of the descriptor's matrix source.
@pytest.mark.parametrize("maximum", [11.5, 17.25])
def test_matrix_bounds_ignore_conflicting_config_form_limits(maximum: float) -> None:
    readings = Readings()
    take_form(readings, FORM_LIMITS.replace("gain_comp", "post_bauer_level"))
    html = (
        '<form method="post"><input type="number" name="post_bauer_level" '
        f'min="1.5" max="{maximum}" step="0.25" value="4"></form>'
    )
    readings.take_file(generation=GENERATION, matrix_form=parse_matrix_form(html))
    row = query.field("post_bauer_level")
    assert row is not None
    bounds = bounds_of(readings, row)
    assert bounds is not None
    assert bounds["max"] == maximum


# Break: retire numeric evidence without notifying subscribers that its bounds disappeared.
@pytest.mark.parametrize("maximum", [9.5, 21.75])
def test_bounds_subscribers_observe_file_evidence_invalidation(maximum: float) -> None:
    readings = Readings()
    row = query.field("gain_comp")
    assert row is not None
    heard: list[Bounds | None] = []
    readings.on_change = partial(record_bounds, heard, readings, row)
    take_form(readings, FORM_LIMITS.replace('max="7.25"', f'max="{maximum}"'))
    readings.break_file("config_form")
    assert tuple(heard) == ({"min": -13.5, "max": maximum, "step": 0.125}, None)


# Break: suppress notification when an unchanged payload restores retired bounds evidence.
@pytest.mark.parametrize("maximum", [9.5, 21.75])
def test_bounds_subscribers_observe_unchanged_evidence_becoming_current(maximum: float) -> None:
    readings = Readings()
    html = FORM_LIMITS.replace('max="7.25"', f'max="{maximum}"')
    take_form(readings, html)
    readings.break_file("config_form")
    row = query.field("gain_comp")
    assert row is not None
    heard: list[Bounds | None] = []
    readings.on_change = partial(record_bounds, heard, readings, row)
    take_form(readings, html)
    assert tuple(heard) == ({"min": -13.5, "max": maximum, "step": 0.125},)


# Break: forget the newer generation when Engine ends and revive obsolete File limits.
@pytest.mark.parametrize("maximum", [9.5, 21.75])
def test_ending_newer_engine_view_does_not_revive_old_file_bounds(maximum: float) -> None:
    readings = Readings()
    html = FORM_LIMITS.replace('max="7.25"', f'max="{maximum}"')
    readings.take_engine(GENERATION, state={"state": "0"})
    take_form(readings, html)
    row = query.field("gain_comp")
    assert row is not None
    readings.take_engine(NEXT_GENERATION, state={"state": "0"})
    during_newer_view = bounds_of(readings, row)
    readings.break_engine()
    after_engine_ends = bounds_of(readings, row)
    take_form(readings, html, NEXT_GENERATION)
    after_fresh_file = bounds_of(readings, row)
    assert (during_newer_view, after_engine_ends, after_fresh_file) == (
        None,
        None,
        {"min": -13.5, "max": maximum, "step": 0.125},
    )
