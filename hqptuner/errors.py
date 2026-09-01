"""The base every HQPTuner-raised error shares: a message for people and a code for programs.

Message text is user-facing and reworded at will, so nothing may branch on it
(``docs/testing.md`` rule 9). ``code`` is the stable half: a short snake_case
identifier naming the cause, carried through to the API body as ``code`` beside
``detail`` (``docs/architecture.md`` "API errors" lists the vocabulary). A class
declares the code most of its raises mean; a raise that means something more
specific passes its own.

A top-level leaf like ``config.py``: it imports nothing from any subpackage, so
every layer may raise it without bending the import contract.
"""

from __future__ import annotations


class HQPTunerError(Exception):
    """An error HQPTuner raised on purpose, carrying a stable ``code``.

    Subclasses set ``code`` at class level to the cause most of their raises
    mean; a raise naming a more specific cause passes ``code=`` explicitly.
    """

    code: str = "error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        """Carry ``message`` for people and, when given, a ``code`` overriding the class default."""
        super().__init__(message)
        if code is not None:
            self.code = code
