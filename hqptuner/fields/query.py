"""The questions every other module asks the register."""

from collections.abc import Mapping
from types import MappingProxyType

from hqptuner.fields.model import Attr, Carry, Codec, Domain, EngineAttr, Field, Location, Plugin, Setter
from hqptuner.fields.register import DEVICE_FIELDS, FIELDS, HOST_INTERFACES, PROOFS, SETTERS


def field(name: str) -> Field | None:
    """Return the row of the field ``name``, or None when the register has no such field."""
    return next((row for row in FIELDS if row.name == name), None)


def setters() -> tuple[Setter, ...]:
    """Return every setter, in apply order."""
    return SETTERS


def stageable() -> tuple[str, ...]:
    """Return the setter keys the pending buffer takes."""
    return tuple(setter.key for setter in SETTERS if setter.stageable)


def staged_routes() -> tuple[Field, ...]:
    """Return the fields a staged form edit may write live."""
    return tuple(row for row in FIELDS if row.staged_route)


def live_controls() -> tuple[str, ...]:
    """Return the fields ``POST /api/config/live`` takes."""
    return tuple(row.name for row in FIELDS if row.live_control)


def snapshot_fields() -> tuple[str, ...]:
    """Return the fields a snapshot holds."""
    return tuple(row.name for row in FIELDS if row.snapshot)


def chain_scoped() -> frozenset[str]:
    """Return the fields that belong to a chain."""
    return frozenset(row.name for row in FIELDS if row.live is not None and row.live.chain is not None)


def realized() -> tuple[Field, ...]:
    """Return the fields the realized config carries across a restart."""
    return tuple(row for row in FIELDS if row.carry is Carry.REALIZED)


def forced() -> Mapping[str, str]:
    """Return each field forced on every restore write, with its forced value."""
    return MappingProxyType({row.name: row.forced for row in FIELDS if row.forced is not None})


def located() -> Mapping[str, Location]:
    """Return every field the File keeps, by name, with its location."""
    return MappingProxyType({row.name: row.location for row in FIELDS if row.location is not None})


def by_plugin() -> Mapping[Plugin, str]:
    """Return the field kept at each plugin attribute."""
    return MappingProxyType({row.location: row.name for row in FIELDS if isinstance(row.location, Plugin)})


def engine_domains() -> Mapping[str, Domain]:
    """Return each ``<engine>`` hardware attribute with the domain its value is checked against."""
    return MappingProxyType({row.location.attr: row.domain for row in FIELDS if isinstance(row.location, EngineAttr)})


def host_interfaces() -> tuple[Attr, ...]:
    """Return the host interfaces kept from the running File on a preset load."""
    return HOST_INTERFACES


def volume_traced() -> frozenset[str]:
    """Return the fields the volume trace follows."""
    return frozenset(row.name for row in FIELDS if row.volume_traced)


def lossy_form() -> frozenset[str]:
    """Return the fields read from ``/backup`` because the form is lossy."""
    return frozenset(row.name for row in FIELDS if row.lossy_form)


def device_field(backend: str) -> str | None:
    """Return the field naming ``backend``'s device, or None when it has none."""
    return DEVICE_FIELDS.get(backend)


def proven_by(name: str) -> str | None:
    """Return the field whose readback proves a write of ``name``, or None when its own readback does."""
    row = field(name)
    if row is None or not isinstance(row.location, Codec) or row.location not in PROOFS:
        return None
    proof = PROOFS[row.location]
    return next((other.name for other in FIELDS if other.location == proof), None)
