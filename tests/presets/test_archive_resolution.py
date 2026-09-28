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
from hqptuner.conf.xmledit import GroundingError

_XML = b'<hqplayerd><engine channels="2"/></hqplayerd>'
_OTHER = b'<hqplayerd><engine channels="8"/></hqplayerd>'


def _archive(members: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return out.getvalue()


def _refusal_code(data: bytes) -> str:
    """The ``code`` of the ``GroundingError`` reading ``data`` raises; empty when the read answers instead."""
    code = ""
    try:
        engineconf.base_config_xml(data)
    except GroundingError as exc:
        code = exc.code
    return code


def test_a_sole_root_xml_is_the_working_config() -> None:
    # a named preset is active: the daemon renames the working member and omits
    # hqplayerd.xml entirely
    archive = _archive({"Speakers.xml": _XML, "data/cfgs/Speakers.xml": _XML})
    assert engineconf.base_config_xml(archive) == _XML


def test_several_root_xmls_without_a_label_resolve_to_nothing_but_by_the_active_label_they_resolve() -> None:
    # honest refusal: guessing which one is live would write the wrong member
    archive = _archive({"Speakers.xml": _XML, "Office.xml": _OTHER, "data/library.xml": b"<library/>"})
    assert (engineconf.base_config_xml(archive), engineconf.base_config_xml(archive, "Speakers")) == (b"", _XML)


def test_a_label_naming_no_member_resolves_to_nothing_but_a_named_label_picks_its_own_member() -> None:
    archive = _archive({"Speakers.xml": _XML, "Office.xml": _OTHER})
    assert (engineconf.base_config_xml(archive, "Headphones"), engineconf.base_config_xml(archive, "Office")) == (
        b"",
        _OTHER,
    )


def test_an_archive_with_no_config_at_all_resolves_to_nothing_but_a_named_member_is_found_by_name() -> None:
    # the daemon's post-profile-load bug: a bare data/ entry and nothing else
    empty = _archive({"data/": b""})
    named = _archive({"hqplayerd.xml": _XML, "data/cfgs/Speakers.xml": _OTHER})
    assert (engineconf.base_config_xml(empty), engineconf.base_config_xml(named)) == (b"", _XML)


def test_bytes_that_are_not_an_archive_are_refused_as_unreadable() -> None:
    # an unreadable archive and an archive with no working config are different
    # facts, so the unreadable one raises instead of reading as empty
    assert _refusal_code(b"<html>gateway timeout</html>") == "archive_unreadable"


def test_the_archive_summary_marks_bytes_that_are_not_a_zip_unreadable_but_names_a_member_when_it_reads() -> None:
    unreadable = engineconf.archive_summary(b"<html>gateway timeout</html>")
    readable = engineconf.archive_summary(_archive({"hqplayerd.xml": _XML}))
    assert (unreadable.readable, "hqplayerd.xml" in readable.members) == (False, True)


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
