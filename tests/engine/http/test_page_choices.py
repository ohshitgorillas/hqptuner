"""One decision says whether a staged value is among the choices its own page lists.

The pages are the daemon's own 6.0.4 captures, so the choices are the daemon's, not a table kept here.
"""

from pathlib import Path

import pytest

from hqptuner.conf import presetconf
from hqptuner.conf.formparse import parse_config_form, parse_matrix_form

_FIXTURES = Path(__file__).parent.parent.parent / "support" / "fixtures"
_CONFIG = parse_config_form((_FIXTURES / "config-form-6.0.4.html").read_text())
_MATRIX = parse_matrix_form((_FIXTURES / "matrix-6.0.4.html").read_text())


_CLEAN = presetconf.ChoiceCheck(refused=(), not_loaded=())


def _check(field: str, value: str) -> presetconf.ChoiceCheck:
    return presetconf.check_choices(_CONFIG, _MATRIX, {field: value})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("matrix_enabled", "on"),
        ("filter", "999999"),
        ("post_bauer_preset", "x"),
        ("mode", "nonsense"),
        ("volume_fixed", "3"),
        ("net_ipv6", "yes"),
    ],
)
def test_a_value_the_page_does_not_offer_is_refused(field: str, value: str) -> None:
    assert _check(field, value).refused == (field,)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("matrix_enabled", "1"),
        ("matrix_enabled", "0"),
        ("filter", "40"),
        ("post_bauer_preset", "cmoy"),
        ("mode", "pcm"),
        ("volume_fixed", "2"),
        ("net_ipv6", "0"),
    ],
)
def test_a_value_the_page_offers_is_not_refused(field: str, value: str) -> None:
    assert _check(field, value) == _CLEAN


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", 'any "text" & more'),
        ("fixed_volume", "-3"),
        ("matrix_pipelines", "[]"),
        ("matrix_profile_delete", "{}"),
    ],
)
def test_a_field_with_no_choices_is_never_refused(field: str, value: str) -> None:
    assert _check(field, value) == _CLEAN


def test_every_refused_field_is_named() -> None:
    result = presetconf.check_choices(_CONFIG, _MATRIX, {"matrix_enabled": "on", "mode": "x", "title": "t"})
    assert sorted(result.refused) == ["matrix_enabled", "mode"]


def test_a_matrix_field_with_no_matrix_page_is_reported_not_loaded_and_never_refused() -> None:
    result = presetconf.check_choices(_CONFIG, None, {"matrix_enabled": "on"})
    assert result == presetconf.ChoiceCheck(refused=(), not_loaded=("matrix_enabled",))


def test_a_config_field_with_no_config_page_is_not_loaded() -> None:
    result = presetconf.check_choices(None, _MATRIX, {"title": "t"})
    assert result == presetconf.ChoiceCheck(refused=(), not_loaded=("title",))


def test_a_field_the_page_does_not_render_is_never_refused() -> None:
    assert _check("wasapi_device", "anything") == _CLEAN


def test_a_clean_batch_names_nothing() -> None:
    result = presetconf.check_choices(_CONFIG, _MATRIX, {"mode": "pcm", "post_bauer_preset": "cmoy"})
    assert result == _CLEAN
