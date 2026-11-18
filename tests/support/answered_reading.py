"""An Engine reading a test writes itself, for building an ``EngineView``, and the enumerations it answers with.

The enumerations are two filters, each as its engine index and its file ID, and the three modes with the PCM one's
index. A suite that needs a different reading writes its own.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

FIRST_ID = "31"
SECOND_ID = "47"
FIRST_INDEX = "0"
SECOND_INDEX = "1"
PCM_MODE = "2"
ENUMERATIONS = {
    "modes": [
        {"index": "0", "name": "SDM (DSD)", "value": "1"},
        {"index": "1", "name": "[source]", "value": "-1"},
        {"index": PCM_MODE, "name": "PCM", "value": "0"},
    ],
    "filters": [
        {"index": FIRST_INDEX, "name": "fixture-first", "value": FIRST_ID},
        {"index": SECOND_INDEX, "name": "fixture-second", "value": SECOND_ID},
    ],
}


@dataclass(frozen=True)
class Answered:
    """One Engine reading as the test writes it."""

    state: Mapping[str, str] | None
    status: Mapping[str, str] | None
    enums: Mapping[str, Sequence[Mapping[str, str]]] | None
    matrix_profiles: Sequence[str] | None
