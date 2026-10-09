"""A deadline the test decides, for code that waits on a reply under its own timeout (docs/testing.md rule 7).

The Control API client waits on every connect, send and read under ``ControlClient``'s ``deadline``. This is
that deadline with no real clock behind it. While HQPlayer answers, a wait is handed its operation's own result
and no deadline runs. Once the test says HQPlayer has fallen silent, nothing more is answered: each wait from
then on abandons its operation and runs out, which is what a deadline does when the reply never comes.
"""

import asyncio
import contextlib
from collections.abc import Awaitable


class VirtualDeadline:
    """A ``wait_for`` whose deadline runs out only once the test has silenced HQPlayer."""

    def __init__(self) -> None:
        """Start with HQPlayer answering."""
        self._silent = False

    def fall_silent(self) -> None:
        """Let every wait from here on run out, as on a daemon that answers nothing more."""
        self._silent = True

    async def wait_for[T](self, fut: Awaitable[T], seconds: float, /) -> T:
        """Answer ``fut``'s result while HQPlayer answers; once it is silent, abandon ``fut`` and run out."""
        if not self._silent:
            return await fut
        abandoned = asyncio.ensure_future(fut)
        abandoned.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await abandoned
        raise TimeoutError(seconds)
