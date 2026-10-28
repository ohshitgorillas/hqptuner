"""An Engine reading a test writes itself, for building an ``EngineView``."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Answered:
    """One Engine reading as the test writes it."""

    state: Mapping[str, str] | None
    status: Mapping[str, str] | None
    enums: Mapping[str, Sequence[Mapping[str, str]]] | None
    matrix_profiles: Sequence[str] | None
