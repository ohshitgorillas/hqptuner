"""The spec's table of fields the File keeps through a codec, shared by the suites that read it."""

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
