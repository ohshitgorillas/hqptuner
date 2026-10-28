"""Which output family a rate or a mode name belongs to, and which chain Status says is running."""

from __future__ import annotations

PCM = "pcm"
SDM = "sdm"

# No PCM rate the engine offers reaches DSD64, so the lowest SDM rate separates
# the two families outright — no rate in Hz is ambiguous between them.
_SDM_FLOOR = 2822400


def rate_family(hz: str) -> str:
    """Which output family a rate in Hz belongs to."""
    return SDM if int(hz) >= _SDM_FLOOR else PCM


def chain_name(name: str) -> str | None:
    """Return the chain a mode name denotes, or None for ``[source]``/anything unknown."""
    upper = (name or "").upper()
    if upper.startswith("PCM"):
        return PCM
    return SDM if upper.startswith(("SDM", "DSD")) else None


def status_chain(status: dict[str, str]) -> str | None:
    """Return the chain the engine is running RIGHT NOW, from what Status reports.

    ``Status.active_mode`` looks like the whole answer and is not: it echoes the
    CONFIGURED mode, so in ``[source]`` it reads ``"[source]"`` and nothing else.
    ``Status.active_rate`` does answer, and unambiguously: it is the rate coming out,
    and its family is the chain that produced it (``rate_family``, no rate lands
    between the two). None when neither answers.
    """
    named = chain_name(status.get("active_mode") or "")
    if named is not None:
        return named
    hz = status.get("active_rate") or ""
    return rate_family(hz) if hz.isdigit() and hz != "0" else None
