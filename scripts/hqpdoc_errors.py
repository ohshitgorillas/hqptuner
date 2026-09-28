#!/usr/bin/env python3
"""`ToolError` and its subclasses for the `hqpdoc` MCP tools.

Every failure a tool can raise is reported to the MCP client as `isError:
true`, never as a protocol error; `hqpdoc_mcp.py` catches `ToolError` for
that. See `hqpdoc_tools.py` for what raises each one.
"""

from pathlib import Path


class ToolError(Exception):
    """A tool-level failure: reported as isError true, never as a protocol error."""


class ManualMissingError(ToolError):
    """The gitignored, `make manual`-built manual directory is absent."""

    def __init__(self, *, manual_rel: Path) -> None:
        """Name the missing manual directory, relative to the repo root."""
        super().__init__(f"{manual_rel} is missing; it is gitignored and built by `make manual`.")


class EmptyTermError(ToolError):
    """`hqp_find` was called with a blank or whitespace-only term."""

    def __init__(self) -> None:
        """Render the fixed wording."""
        super().__init__("hqp_find needs a non-empty term.")


class InvalidCapError(ToolError):
    """`hqp_find`'s `cap` argument was less than 1."""

    def __init__(self, *, cap: int) -> None:
        """Name the offending `cap` value."""
        super().__init__(f"hqp_find cap must be at least 1, not {cap}.")


class InvalidContextError(ToolError):
    """`hqp_find`'s `context` argument was negative."""

    def __init__(self, *, context: int) -> None:
        """Name the offending `context` value."""
        super().__init__(f"hqp_find context must be at least 0, not {context}.")


class SectionFileMissingError(ToolError):
    """INDEX.md names a section file that is not actually on disk."""

    def __init__(self, *, number: str, filename: str, manual_rel: Path) -> None:
        """Name the section `number`, the missing `filename`, and the manual directory it should sit under."""
        super().__init__(f"section {number} names {filename}, which is missing from {manual_rel}.")


class SectionNotFoundError(ToolError):
    """No INDEX.md row carries the requested section number."""

    def __init__(self, *, number: str, index_rel: Path) -> None:
        """Name the requested `number` and the INDEX.md path searched."""
        super().__init__(f"no section {number!r} in {index_rel}.")


class PageNotFoundError(ToolError):
    """No section file carries a `[page N]` marker for the requested page."""

    def __init__(self, *, page: int, manual_rel: Path) -> None:
        """Name the requested `page` and the manual directory searched."""
        super().__init__(f"page {page} not found in {manual_rel}.")


class ReadmeHeadingNumberNotFoundError(ToolError):
    """No readme heading carries the requested number."""

    def __init__(self, *, key: str) -> None:
        """Name the requested heading number, `key`."""
        super().__init__(f"no readme heading numbered {key!r}.")


class AmbiguousReadmeHeadingError(ToolError):
    """Several readme headings' names partially match the requested key."""

    def __init__(self, *, key: str, candidates: str) -> None:
        """Name the ambiguous `key` and its rendered `candidates`."""
        super().__init__(f"{key!r} matches several readme headings: {candidates}.")


class ReadmeHeadingNotFoundError(ToolError):
    """No readme heading's name matches the requested key at all."""

    def __init__(self, *, key: str) -> None:
        """Name the unmatched `key`."""
        super().__init__(f"no readme heading matching {key!r}.")


class EmptyKeyError(ToolError):
    """`hqp_readme` was called with a blank or whitespace-only key."""

    def __init__(self) -> None:
        """Render the fixed wording."""
        super().__init__("hqp_readme needs a non-empty key.")


class ReadmeMissingError(ToolError):
    """hqplayerd-readme.txt is absent, or carries no headings at all."""

    def __init__(self, *, readme_rel: Path) -> None:
        """Name the readme path, relative to the repo root."""
        super().__init__(f"{readme_rel} is missing or has no headings.")
