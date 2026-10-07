"""A value read from one path, re-read only when that path's stat signature moved.

The signature is ``(st_mtime_ns, st_size)``: a rewrite moves at least one of them, so a reader that keys on it serves
a held value until the file, or a directory's entry list, actually changed. A store invalidates on its own writes as
well, since two writes of the same size inside one timestamp tick would otherwise read as one.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

#: A path's ``(st_mtime_ns, st_size)``, or ``None`` when nothing is there.
Signature = tuple[int, int] | None


def signature(path: Path) -> Signature:
    """Return ``path``'s ``(st_mtime_ns, st_size)``, ``None`` when it does not exist."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    return (st.st_mtime_ns, st.st_size)


class SignedRead[T]:
    """The last value ``read`` returned, held against the signature ``path`` carried just before it ran.

    The signature is taken before the read, so a write landing between the two leaves a held value whose signature is
    already stale and is read again next time. A read that raises holds nothing, so the next call raises afresh.
    """

    def __init__(self, path: Path, read: Callable[[], T]) -> None:
        """Bind the path whose signature keys the value and the reader that produces it."""
        self._path = path
        self._read = read
        self._held: tuple[Signature, T] | None = None

    def get(self) -> T:
        """Return the held value while ``path``'s signature is unchanged, re-reading it otherwise."""
        sig = signature(self._path)
        if self._held is None or self._held[0] != sig:
            self._held = None
            self._held = (sig, self._read())
        return self._held[1]

    def drop(self) -> None:
        """Forget the held value, so the next ``get`` reads whatever the signature says."""
        self._held = None
