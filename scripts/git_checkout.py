"""Read a checkout's git layout from disk: its main checkout, its own git dir, its branch.

The gates run as bare scripts with ``scripts/`` off ``sys.path``, so they load
this module by path rather than importing it.
"""

from __future__ import annotations

from pathlib import Path


def main_checkout(root: Path) -> Path:
    """Return the main checkout for ``root``, which is ``root`` itself unless it is a worktree.

    A worktree's ``.git`` is a file naming its private git dir, and that dir's
    ``commondir`` file names the shared one, whose parent is the main checkout.
    """
    dotgit = root / ".git"
    if not dotgit.is_file():
        return root
    gitdir = own_gitdir(root)
    common = gitdir / (gitdir / "commondir").read_text().strip()
    return common.resolve().parent


def own_gitdir(root: Path) -> Path:
    """Return the git dir holding ``root``'s own ``HEAD``: ``.git`` itself, or the one a worktree's ``.git`` names."""
    dotgit = root / ".git"
    if not dotgit.is_file():
        return dotgit
    gitdir = Path(dotgit.read_text().split(":", 1)[1].strip())
    return gitdir if gitdir.is_absolute() else root / gitdir


def branch(root: Path) -> str | None:
    """Return the branch checked out in ``root``, the commit a detached ``HEAD`` names, or None outside git."""
    head = own_gitdir(root) / "HEAD"
    if not head.is_file():
        return None
    text = head.read_text().strip()
    return text.removeprefix("ref: refs/heads/")
