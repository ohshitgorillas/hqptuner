"""The host network interfaces a preset load keeps from the running config.

A preset is a whole-config snapshot, so it also carries the interface names set when it was
saved. Restored verbatim, those undo a later change to the interfaces, and a name that no
longer exists stops the daemon from starting.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.conf import xmledit
from hqptuner.fields.query import host_interfaces

if TYPE_CHECKING:
    from hqptuner.fields.model import Attr


def _set_interfaces(xml: bytes) -> dict[Attr, str]:
    """Return the interface attributes ``xml`` sets, keyed by element and attribute; one it leaves unset is absent."""
    found: dict[Attr, str] = {}
    for interface in host_interfaces():
        m = xmledit.find_element(xml, interface.tag)
        value = None if m is None else xmledit.get_attr(m.group(0), interface.attr)
        if value is not None:
            found[interface] = value
    return found


def keep_interfaces(preset_xml: bytes, running_xml: bytes) -> bytes:
    """Return ``preset_xml`` carrying the running config's interface attributes, every other byte untouched.

    An attribute the running config does not set is removed, so the daemon keeps applying its own default. Without a
    running config to read, the preset is returned as saved.
    """
    if not running_xml:
        return preset_xml
    running = _set_interfaces(running_xml)
    xml = preset_xml
    for interface in host_interfaces():
        if interface in running:
            xml = xmledit.edit_element(xml, interface.tag, interface.attr, running[interface])
        elif (m := xmledit.find_element(xml, interface.tag)) is not None:
            xml = xmledit.splice(xml, m.span(), xmledit.drop_attr(m.group(0), interface.attr))
    return xml
