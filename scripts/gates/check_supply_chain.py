#!/usr/bin/env python3
"""Gate: the release pipeline fetches no remote code it has not pinned.

A tag names whatever commit its owner last pointed it at, so a workflow that
calls an action by tag runs code its repository did not review: the tag moves
and the next run follows it. A full commit SHA names one tree, and the tag stays
beside it as a trailing comment for the reader and for Dependabot.

A local ``./`` call runs this repository's own file and needs no pin.

A script fetched and piped straight into a shell is the same hole one step
earlier: nothing checks the bytes before they run. The install fetches an
archive, checks it against the checksum its release publishes, and only then
runs it.

Usage: ``python scripts/gates/check_supply_chain.py [checkout-root]``
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

#: A ``uses:`` step key, with or without the list dash, and the ref after it.
USES = re.compile(r"^\s*(?:-\s+)?uses:\s*(?P<ref>[^\s#]+)")

#: An action ref naming a full commit.
PINNED_REF = re.compile(r"@[0-9a-f]{40}$")


#: A download piped into an interpreter: a fetcher, then ``|``, then a shell or
#: ``Invoke-Expression``, with any ``env NAME=value`` or ``sudo`` prefix between.
PIPED_INSTALL = re.compile(
    r"\b(?:curl|wget|irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^|]*"
    r"\|\s*(?:(?:env|sudo)\s+(?:\w+=\S+\s+)*)*(?:sh|bash|zsh|iex|Invoke-Expression)\b",
    re.IGNORECASE,
)


def action_failures(name: str, source: str) -> list[str]:
    """One line per remote action in a workflow that is not named by a full commit SHA."""
    lines: list[str] = []
    for number, text in enumerate(source.splitlines(), start=1):
        match = USES.match(text)
        if match is None:
            continue
        ref = match["ref"]
        if not ref.startswith("./") and not PINNED_REF.search(ref):
            lines.append(f"{name}:{number}: {ref} is not pinned to a full 40-hex commit SHA")
    return lines


def pipe_failures(name: str, source: str) -> list[str]:
    """One line per step in a workflow that pipes a downloaded script into a shell."""
    return [
        f"{name}:{number}: a downloaded script is piped into a shell: {text.strip()}"
        for number, text in enumerate(source.splitlines(), start=1)
        if PIPED_INSTALL.search(text)
    ]


def main(argv: list[str]) -> int:
    """Check the workflows of one checkout, this one unless a root is named, and say so in the exit status."""
    root = Path(argv[0]) if argv else ROOT
    workflows = sorted((root / ".github" / "workflows").glob("*.yml"))
    lines = [
        line
        for path in workflows
        for check in (action_failures, pipe_failures)
        for line in check(path.name, path.read_text(encoding="utf-8"))
    ]

    for line in lines:
        print(line)
    if lines:
        print(f"\n{len(lines)} problem(s). Pin every remote action by commit and check every download.")
        return 1
    print(f"[ok] all {len(workflows)} workflows pin their remote code")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
