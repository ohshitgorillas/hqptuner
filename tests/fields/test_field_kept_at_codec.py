"""The register names the field it keeps at a codec, with no optional to narrow.

Every expected value is a row of the spec's table of fields the File keeps through a codec.
"""

import pytest

from hqptuner.fields import query
from hqptuner.fields.model import Codec

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


@pytest.mark.parametrize(("codec", "field"), CODEC_HOLDS.items())
def test_the_field_kept_at_a_codec_is_the_one_field_that_codec_holds(codec: Codec, field: str) -> None:
    assert query.kept_at(codec) == field
