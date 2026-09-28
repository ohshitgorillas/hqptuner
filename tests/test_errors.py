"""``HQPTunerError`` — the base every HQPTuner-raised error shares.

A subclass sets ``code`` at class level to the cause most of its raises mean; a
raise naming a more specific cause passes its own ``code``, which overrides the
class default.
"""

from hqptuner.errors import HQPTunerError


def test_an_explicit_code_overrides_the_class_default() -> None:
    assert HQPTunerError("unused", code="specific_cause").code == "specific_cause"
