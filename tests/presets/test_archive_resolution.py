"""Resolving the working config inside a ``/backup`` archive.

The daemon names that member after its OWN active profile: ``hqplayerd.xml`` on
``[default]``, a root-level ``<Profile>.xml`` otherwise (protocol.md §3.6). An
archive HQPTuner cannot resolve reads as "no working config", which is also what
the daemon's empty-backup bug produces — so the resolver failing quietly meant
every apply refused with a message blaming a daemon bug that a restart does not
clear. These are the shapes it has to get right.

Inputs are real archives in the daemon's shape rather than stubs, so a resolver
that only works against a hand-shaped dict cannot pass.
"""

import io
import zipfile

from hqptuner.conf import engineconf

_XML = b'<hqplayerd><engine channels="2"/></hqplayerd>'
_OTHER = b'<hqplayerd><engine channels="8"/></hqplayerd>'


def _archive(members: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return out.getvalue()


def test_the_default_working_config_is_found_by_name() -> None:
    archive = _archive({"hqplayerd.xml": _XML, "data/cfgs/Speakers.xml": _OTHER})
    assert engineconf.base_config_xml(archive) == _XML


def test_a_sole_root_xml_is_the_working_config() -> None:
    # a named preset is active: the daemon renames the working member and omits
    # hqplayerd.xml entirely
    archive = _archive({"Speakers.xml": _XML, "data/cfgs/Speakers.xml": _XML})
    assert engineconf.base_config_xml(archive) == _XML


def test_several_root_xmls_resolve_by_the_active_label() -> None:
    archive = _archive({"Speakers.xml": _XML, "Office.xml": _OTHER, "data/library.xml": b"<library/>"})
    assert engineconf.base_config_xml(archive, "Speakers") == _XML


def test_the_active_label_picks_its_own_member_not_the_first() -> None:
    archive = _archive({"Speakers.xml": _XML, "Office.xml": _OTHER})
    assert engineconf.base_config_xml(archive, "Office") == _OTHER


def test_several_root_xmls_without_a_label_resolve_to_nothing() -> None:
    # honest refusal: guessing which one is live would write the wrong member
    archive = _archive({"Speakers.xml": _XML, "Office.xml": _OTHER})
    assert engineconf.base_config_xml(archive) == b""


def test_a_label_naming_no_member_resolves_to_nothing() -> None:
    archive = _archive({"Speakers.xml": _XML, "Office.xml": _OTHER})
    assert engineconf.base_config_xml(archive, "Headphones") == b""


def test_an_archive_with_no_config_at_all_resolves_to_nothing() -> None:
    # the daemon's post-profile-load bug: a bare data/ entry and nothing else
    assert engineconf.base_config_xml(_archive({"data/": b""})) == b""


def test_bytes_that_are_not_an_archive_resolve_to_nothing() -> None:
    # a restarting daemon answers /backup with an error page; that used to raise
    # BadZipFile out to the API as a 500 instead of taking the outage path
    assert engineconf.base_config_xml(b"<html>gateway timeout</html>") == b""


def test_the_archive_summary_names_a_member() -> None:
    assert "hqplayerd.xml" in engineconf.archive_summary(_archive({"hqplayerd.xml": _XML})).members


def test_the_archive_summary_marks_bytes_that_are_not_a_zip_unreadable() -> None:
    assert engineconf.archive_summary(b"<html>gateway timeout</html>").readable is False


def test_apply_to_all_names_every_preset_snapshot_beside_the_working_config() -> None:
    # one preset is the active one; "all presets" has to reach the other too
    archive = _archive(
        {
            "hqplayerd.xml": _XML,
            engineconf.snapshot_member_name("Speakers"): _XML,
            engineconf.snapshot_member_name("Office"): _OTHER,
        }
    )
    assert set(engineconf.config_members(archive, "Speakers", all_presets=True)) == {
        "hqplayerd.xml",
        engineconf.snapshot_member_name("Speakers"),
        engineconf.snapshot_member_name("Office"),
    }
