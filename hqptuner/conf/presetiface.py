"""The host network interfaces a preset load keeps from the running config.

A preset is a whole-config snapshot, so it also carries the interface names set when it was
saved. Restored verbatim, those undo a later change to the interfaces, and a name that no
longer exists stops the daemon from starting.
"""

from __future__ import annotations

from hqptuner.conf import xmledit

#: The attributes that name a host network interface: the UPnP renderer's (readme §1.4) and
#: the NAA discovery multicast's (readme §1.3.5).
INTERFACES: tuple[tuple[str, str], ...] = (("upnp", "interface"), ("network", "mcast_interface"))


def _set_interfaces(xml: bytes) -> dict[tuple[str, str], str]:
    """Return the interface attributes ``xml`` sets, keyed by element and attribute; one it leaves unset is absent."""
    found: dict[tuple[str, str], str] = {}
    for tag, attr in INTERFACES:
        m = xmledit.find_element(xml, tag)
        value = None if m is None else xmledit.get_attr(m.group(0), attr)
        if value is not None:
            found[(tag, attr)] = value
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
    for tag, attr in INTERFACES:
        if (tag, attr) in running:
            xml = xmledit.edit_element(xml, tag, attr, running[(tag, attr)])
        elif (m := xmledit.find_element(xml, tag)) is not None:
            xml = xmledit.splice(xml, m.span(), xmledit.drop_attr(m.group(0), attr))
    return xml
