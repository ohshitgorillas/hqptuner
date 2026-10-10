"""One seam for every store read, write and delete the filesystem refuses: the ``OSError`` becomes ``store_unwritable``.

Each store wraps its own filesystem calls in ``reading``, ``saving`` or ``deleting``, naming what it holds; the sentence
a user reads names that, the file or directory the operating system refused, and the operating system's own
description of the errno.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import TYPE_CHECKING

from hqptuner.errors import HQPTunerError

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from contextlib import AbstractContextManager
    from pathlib import Path


class StoreUnwritableError(HQPTunerError, OSError):
    """A store read, write or delete the filesystem refused.

    Subclasses ``OSError`` on purpose: a caller that already catches ``OSError`` around a store operation keeps
    catching it, and only the answer a client reads changes.
    """

    code = "store_unwritable"


@contextmanager
def _refusing(sentence: Callable[[object, str], str], where: Path) -> Iterator[None]:
    """Turn an ``OSError`` raised inside the block into ``StoreUnwritableError`` worded by ``sentence(path, reason)``.

    The path named is the one the operating system refused, falling back to ``where`` when the error carries none.
    Blocks do not nest: the error raised here is itself an ``OSError``.
    """
    try:
        yield
    except OSError as exc:
        raise StoreUnwritableError(sentence(exc.filename or where, exc.strerror or str(exc))) from exc


def reading(what: str, where: Path) -> AbstractContextManager[None]:
    """Refuse a read inside the block as ``StoreUnwritableError`` naming ``what`` the store holds."""
    return _refusing(lambda path, reason: f"Could not read {what} from {path}: {reason}.", where)


def saving(what: str, where: Path) -> AbstractContextManager[None]:
    """Refuse a write inside the block as ``StoreUnwritableError`` naming ``what`` the store holds."""
    return _refusing(lambda path, reason: f"Could not save {what} to {path}: {reason}.", where)


def deleting(what: str, where: Path) -> AbstractContextManager[None]:
    """Refuse a delete inside the block as ``StoreUnwritableError`` naming ``what`` the store holds."""
    return _refusing(lambda path, reason: f"Could not delete {what} in {path}: {reason}.", where)
