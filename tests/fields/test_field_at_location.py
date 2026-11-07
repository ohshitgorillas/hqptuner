"""The register names the field the File keeps at a location, the reverse of ``query.located``.

Every expected value is a row of the spec's table of fields the File keeps through a codec.
"""

import pytest

from hqptuner.fields import query
from hqptuner.fields.model import Attr, Codec

#: "Fields the File keeps through a codec": each codec and the one field it holds.
CODEC_HOLDS: dict[Codec, str] = {
    Codec.NET_DEVICE: "net_device",
    Codec.FIXED_ENABLED: "fixed_volume_enabled",
    Codec.FIXED_LEVEL: "fixed_volume",
    Codec.PIPELINES: "matrix_pipelines",
    Codec.PROFILES: "matrix_profiles",
    Codec.PROFILE_SAVE: "matrix_profile_save",
    Codec.PROFILE_DELETE: "matrix_profile_delete",
}

#: A host interface the File keeps but the register holds no field for.
UNKEPT = Attr("upnp", "interface")
#: A codec location and the field the File keeps there, the contrast to ``UNKEPT``.
KEPT, KEPT_FIELD = Codec.NET_DEVICE, "net_device"


@pytest.mark.parametrize(("codec", "field"), CODEC_HOLDS.items())
def test_a_codec_location_names_the_field_the_file_keeps_through_it(codec: Codec, field: str) -> None:
    assert query.at(codec) == field


def test_a_location_no_field_is_kept_at_names_no_field_where_a_codec_location_does() -> None:
    assert (query.at(UNKEPT), query.at(KEPT)) == (None, KEPT_FIELD)
