"""The register names the field the File keeps at a location, the reverse of ``query.located``.

Every expected value is a row of the spec's table of fields the File keeps through a codec.
"""

import pytest
from field_codecs import CODEC_HOLDS

from hqptuner.fields import query
from hqptuner.fields.model import Attr, Codec

#: A host interface the File keeps but the register holds no field for.
UNKEPT = Attr("upnp", "interface")
#: A codec location and the field the File keeps there, the contrast to ``UNKEPT``.
KEPT, KEPT_FIELD = Codec.NET_DEVICE, "net_device"


@pytest.mark.parametrize(("codec", "field"), CODEC_HOLDS.items())
def test_a_codec_location_names_the_field_the_file_keeps_through_it(codec: Codec, field: str) -> None:
    assert query.at(codec) == field


def test_a_location_no_field_is_kept_at_names_no_field_where_a_codec_location_does() -> None:
    assert (query.at(UNKEPT), query.at(KEPT)) == (None, KEPT_FIELD)
