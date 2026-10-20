"""Every `<engine>` attribute's domain is a Choice or an Integer.

The `<engine>` attribute validator words a refusal for those two domain kinds
only, so a register row keeping a field at an `<engine>` attribute with any
other domain would leave a value with no refusal to word.
"""

from hqptuner.fields.model import Choice, EngineAttr, Integer
from hqptuner.fields.register import FIELDS

#: The domain kinds the `<engine>` attribute validator words a refusal for.
WORDED_KINDS = (Choice, Integer)

#: The fields the register keeps at an `<engine>` attribute.
ENGINE_FIELDS = frozenset({"cuda", "multicore", "ecores", "nblocks", "cuda_dev", "cuda_cdev"})


def test_every_engine_attribute_domain_is_a_choice_or_an_integer() -> None:
    kinds = {row.name: type(row.domain) for row in FIELDS if isinstance(row.location, EngineAttr)}
    worded = frozenset(name for name, kind in kinds.items() if issubclass(kind, WORDED_KINDS))
    unworded = {name: kind.__name__ for name, kind in kinds.items() if not issubclass(kind, WORDED_KINDS)}
    assert (worded, unworded) == (ENGINE_FIELDS, {})
