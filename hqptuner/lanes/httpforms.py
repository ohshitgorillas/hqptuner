"""Refresh of the three polled 8088 forms — /config, /matrix and /speakers.

Split out of ``manager`` on size alone; the behaviour is unchanged. It sits with
the lanes because it is the same shape as they are: a function over the manager
that owns one slice of the daemon conversation, here the read side of the HTTP
lane the manager polls on every tick.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..manager import ConnectionManager


async def refresh(mgr: ConnectionManager) -> None:
    """Best-effort refresh of the /config, /matrix and /speakers snapshots. A
    failure on the 8088 lane must never fail the 4321 poll — the last-good form is
    kept and only that form's error is recorded.

    One table instead of three identical try/except blocks: a fourth polled form
    is a row, not another block to keep in step. The getters are bound methods
    rather than names looked up by string — reflection here would hide them from
    the dead-code gate, which is how a genuinely orphaned getter would then
    survive unnoticed.
    """
    http = mgr.http_client
    if http is None:
        return
    forms: tuple[tuple[str, str, Callable[[], Awaitable[dict[str, Any]]]], ...] = (
        ("config_form", "config_error", http.get_config),
        ("matrix_form", "matrix_error", http.get_matrix),
        ("speakers_form", "speakers_error", http.get_speakers),
    )
    for form_attr, error_attr, getter in forms:
        try:
            form = await getter()
        except Exception as exc:
            setattr(mgr, error_attr, str(exc))
            continue
        setattr(mgr, form_attr, form)
        setattr(mgr, error_attr, None)
