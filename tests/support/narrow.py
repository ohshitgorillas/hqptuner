"""Narrowing an optional in a test without spending the file's one assertion.

Plenty of production calls return ``X | None`` — ``StaticMetadata.filter_entry``,
``ControlClient.get_status``'s metadata half, ``ConnectionManager.client``. A test
that goes on to subscript the result has to rule ``None`` out first, and the
obvious ``assert value is not None`` costs the test its single assertion
(``docs/testing.md``, enforced by ``scripts/gates/check_test_assertions.py``).

``present`` does the narrowing in a helper instead. A ``None`` arriving here is a
broken fixture, not the behavior under test, so it raises rather than asserts.
"""

from __future__ import annotations


def present[T](value: T | None) -> T:
    """``value``, or a failure naming the fixture that came back empty."""
    if value is None:
        raise AssertionError("expected a value, got None")
    return value
