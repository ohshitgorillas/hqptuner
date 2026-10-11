"""The staged-changes buffer: what is staged, merged and dropped, with no web layer in sight."""

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class PendingSnapshot:
    """The staged buffer as every staging route answers with it: live-lane buckets and restore-lane fields."""

    live: dict[str, dict[str, str]]
    http: dict[str, str]


@dataclass(frozen=True)
class AutosaveState:
    """``POST /api/autosave``'s answer: whether auto-save is now armed."""

    autosave: bool


class PendingStore:
    """Server-side staged-changes buffer.

    Survives browser reloads because it lives on the backend, not the client. ``on_change`` runs at the end of every
    stage, drop and clear, so whoever relays the buffer hears of an edit without waiting to poll for it.
    """

    def __init__(self, on_change: Callable[[], None] = lambda: None) -> None:
        """Start with both buckets empty — nothing staged."""
        self.live: dict[str, dict[str, str]] = {}
        self.http: dict[str, str] = {}
        self._on_change = on_change

    def stage(self, live: dict[str, dict[str, str]], http: dict[str, str]) -> None:
        """Merge entries into the buffer, a later value for the same key replacing the earlier one.

        The merge is shallow on the live side: a live key's whole argument bucket is replaced, not merged per argument.
        """
        self.live.update(live)
        self.http.update(http)
        self._on_change()

    def drop(self, live: dict[str, list[str]], http: list[str]) -> None:
        """Remove named entries.

        Names that are not staged are ignored — the client sends the whole set of entries that read clean, not a diff,
        so a name it has already dropped must not be an error. A live bucket emptied of its arguments goes with them:
        an empty bucket is not "no change", it is a setter the apply would still call.
        """
        for field in http:
            self.http.pop(field, None)
        for key, args in live.items():
            bucket = self.live.get(key)
            if bucket is None:
                continue
            for arg in args:
                bucket.pop(arg, None)
            if not bucket:
                del self.live[key]
        self._on_change()

    def clear(self) -> None:
        """Throw the whole buffer away — what a clean apply and an explicit discard both end with."""
        self.live = {}
        self.http = {}
        self._on_change()

    def snapshot(self) -> PendingSnapshot:
        """Return both buckets as the wire shape every staging route answers with."""
        return PendingSnapshot(live=self.live, http=self.http)
