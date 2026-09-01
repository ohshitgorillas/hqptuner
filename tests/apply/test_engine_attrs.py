"""Writing an engine attribute the daemon left out of the document.

hqplayerd omits an ``<engine>`` attribute entirely while it sits at its default
(hqplayerd-readme.txt §1.2), so an override routinely targets an attribute that
is not in the config XML at all. A writer that only substitutes existing values
drops those overrides on the floor and the apply reads as a no-op.

"Everything else is untouched" is pinned by
tests/apply/test_engine_apply.py::test_apply_engine_preserves_unrelated_attribute;
this file is about the insertion alone.
"""

from defusedxml.ElementTree import fromstring as _fromstring

from hqptuner.conf import engineconf

_NO_AUTO_FAMILY = b'<hqplayerd><engine channels="2"/></hqplayerd>'


def _engine_attrs(xml: bytes) -> dict[str, str]:
    """The ``<engine>`` tag's attributes, by a real parse of the produced document."""
    return dict(next(iter(_fromstring(xml.decode()).iter("engine"))).attrib)


def test_an_attribute_the_document_omits_is_written_onto_the_engine_tag() -> None:
    written = engineconf.set_engine_attrs(_NO_AUTO_FAMILY, {"auto_family": "1"})
    assert _engine_attrs(written).get("auto_family") == "1"
