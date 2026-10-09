"""One seam for every store write the filesystem refuses: the ``OSError`` becomes ``store_unwritable``.

Each store wraps its own writes in ``saving``, naming what it holds; the sentence a user reads names that, the file
or directory the operating system refused, and the operating system's own description of the errno.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import TYPE_CHECKING

from hqptuner.errors import HQPTunerError

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


class StoreUnwritableError(HQPTunerError, OSError):
    """A store write the filesystem refused.

    Subclasses ``OSError`` on purpose: a caller that already catches ``OSError`` around a store write keeps catching
    it, and only the answer a client reads changes.
    """

    code = "store_unwritable"

    def __init__(self, *, what: str, path: str | Path, reason: str) -> None:
        """Render the wording naming ``what`` was being saved, ``path`` it was refused on and the OS's ``reason``."""
        super().__init__(f"Could not save {what} to {path}: {reason}.")


@contextmanager
def saving(what: str, where: Path) -> Iterator[None]:
    """Turn an ``OSError`` raised inside the block into ``StoreUnwritableError`` naming ``what`` the store holds.

    The path named is the one the operating system refused, falling back to ``where`` when the error carries none.
    Blocks do not nest: the error raised here is itself an ``OSError``.
    """
    try:
        yield
    except OSError as exc:
        raise StoreUnwritableError(what=what, path=exc.filename or where, reason=exc.strerror or str(exc)) from exc
