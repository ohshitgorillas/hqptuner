"""Whether the settings in force already treat the junk verdict in hand.

Two call forms answer that: ``treated``, given the engaged junk filter and the
corner a verdict names, and ``treats``, given the verdict, the engaged junk
filter and the main filter's name.
"""

from __future__ import annotations

from typing import Any

import pytest

from hqptuner.engine.junkadvisor import treated, treats

Verdict = dict[str, Any]

CORNER_30K = "30k"

VERDICT_40K: Verdict = {
    "filter": "40k",
    "families": ["poly-sinc-gauss-hires", "poly-sinc-ext2-hires"],
}


@pytest.mark.parametrize(
    ("junk_filter", "already_treated"),
    [
        ("20k", True),
        ("30k", True),
        ("2x", True),
        ("40k", False),
        ("50k", False),
        ("none", False),
        (None, False),
    ],
    ids=["20k", "30k", "2x", "40k", "50k", "none", "nothing engaged"],
)
def test_an_engaged_junk_filter_covers_a_corner_no_lower_than_its_own(
    junk_filter: str | None, already_treated: bool
) -> None:
    assert treated(junk_filter, CORNER_30K) is already_treated


@pytest.mark.parametrize(
    ("filter_name", "already_treated"),
    [
        ("poly-sinc-gauss-hires", True),
        ("poly-sinc-ext2-hires-lp", True),
        ("xtr-poly-sinc-gauss-hires", False),
        ("sinc-M", False),
        (None, False),
    ],
    ids=[
        "an offered family exactly",
        "an offered family with a suffix",
        "an offered family behind a prefix",
        "an unoffered filter",
        "no main filter",
    ],
)
def test_a_main_filter_treats_a_verdict_only_when_a_family_starts_its_name(
    filter_name: str | None, already_treated: bool
) -> None:
    assert treats(VERDICT_40K, None, filter_name) is already_treated
