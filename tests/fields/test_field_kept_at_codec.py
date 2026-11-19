"""The register names the field it keeps at a codec, with no optional to narrow.

Every expected value is a row of the spec's table of fields the File keeps through a codec.
"""

import pytest
from field_codecs import CODEC_HOLDS

from hqptuner.fields import query
from hqptuner.fields.model import Codec


@pytest.mark.parametrize(("codec", "field"), CODEC_HOLDS.items())
def test_the_field_kept_at_a_codec_is_the_one_field_that_codec_holds(codec: Codec, field: str) -> None:
    assert query.kept_at(codec) == field
