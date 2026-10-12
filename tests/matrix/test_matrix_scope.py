"""Reading the live matrix body out of a config snapshot.

A ``<matrix>`` element that is self-closing, or opened and never closed, has no
body to read, and asking for that body is refused with ``MatrixNoBodyError``
rather than answered with a span that points at the wrong bytes.
"""

import pytest

from hqptuner.conf.matrixscope import MatrixNoBodyError, matrix_body_span

ROW = b'<pipeline channel="0" gain="-2" mixdown="0" process="" source="0"/>'

# hqplayerd parks a superseded block in a comment, so a closing tag can follow a
# self-closing live element without belonging to it
SELF_CLOSING_BEFORE_A_PARKED_BODY = (
    b'<hqplayerd><engine channels="2"><matrix enabled="0"/>'
    b'<!-- <matrix enabled="1">' + ROW + b"</matrix> -->"
    b"</engine></hqplayerd>"
)

NEVER_CLOSED = b'<hqplayerd><engine channels="2"><matrix enabled="1">' + ROW + b"</engine></hqplayerd>"


@pytest.mark.parametrize(
    "xml",
    [
        pytest.param(SELF_CLOSING_BEFORE_A_PARKED_BODY, id="self-closing"),
        pytest.param(NEVER_CLOSED, id="never-closed"),
    ],
)
def test_reading_a_matrix_with_no_body_is_refused(xml: bytes) -> None:
    with pytest.raises(MatrixNoBodyError):
        matrix_body_span(xml)
