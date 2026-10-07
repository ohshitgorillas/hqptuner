"""Shared dependencies and response shapes for the /api routers.

``app`` and ``matrixapi`` are one REST surface split by the file-length gate, so
they had grown two verbatim copies of the same three helpers and twelve copies
of the credentials guard. A guard that must be remembered on every new route is
a guard that eventually is not: as FastAPI dependencies it rides the signature
instead — ``def matrix(mgr: HttpMgr)`` cannot forget to check.

No route idle-gates. A write that reloads or restarts the engine interrupts
playback, and that is the user's call to make — HQPTuner does not decide on
their behalf that they may not do it right now (project rule: never idle-gate a
user action).
"""

import contextlib
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, Request

from hqptuner.api.errors import DaemonReadFailedError, ErrorBody, InvalidInputError, NotLoadedError, refuse
from hqptuner.conf.xmledit import GroundingError
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane
from hqptuner.presets.presetlane import MirrorOutcome, PresetSaveResult


class NoCredentialsConfiguredError(ErrorBody):
    """No hqplayerd management credentials were ever configured, so the 8088 lane does not exist."""

    code = "no_credentials"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("no hqplayerd credentials configured")


class GetFormFailedError(ErrorBody):
    """A polled 8088 form's own GET failed, naming which form and the underlying error."""

    code = "daemon_read_failed"

    def __init__(self, *, label: str, error: str) -> None:
        """Render the wording naming the failed form's ``label`` and the ``error`` it answered with."""
        super().__init__(f"GET {label} failed: {error}")


def manager_of(request: Request) -> ConnectionManager:
    """Return the app's connection manager. Reads never touch the socket."""
    mgr: ConnectionManager = request.app.state.manager
    return mgr


def config_of(request: Request) -> Config:
    """Return the app's own ``Config``, the one it was built from — never a fresh default."""
    cfg: Config = request.app.state.config
    return cfg


def require_credentials(request: Request) -> None:
    """503 unless hqplayerd management credentials were configured.

    Without them the 8088 lane does not exist, so every route that reads or writes persistent config is unavailable
    rather than broken.

    Asked of the manager rather than of ``app.state``, because the manager is where a credential saved at runtime
    installs the new client (``POST /api/connection``); a copy on the app state would still read "no credentials"
    after the pair arrived.
    """
    credentialed(manager_of(request))


def credentialed(manager: ConnectionManager) -> ConnectionManager:
    """Return ``manager``, refusing with ``no_credentials`` while it holds no 8088 client."""
    if manager.http_client is None:
        raise refuse(NoCredentialsConfiguredError())
    return manager


def _http_manager(request: Request) -> ConnectionManager:
    require_credentials(request)
    return manager_of(request)


Mgr = Annotated[ConnectionManager, Depends(manager_of)]
HttpMgr = Annotated[ConnectionManager, Depends(_http_manager)]
Cfg = Annotated[Config, Depends(config_of)]


@dataclass(frozen=True)
class Snapshot[T]:
    """Last-loaded state, flagged stale when the daemon is unreachable, with when it was loaded."""

    stale: bool
    loaded_at: float | None
    data: T


def snapshot[T](manager: ConnectionManager, data: T | None) -> Snapshot[T]:
    """Serve last-loaded state, flagged stale when the daemon is unreachable.

    Never a socket wait (connection-manager fail-fast rule).
    """
    if data is None:
        raise refuse(NotLoadedError())
    return Snapshot(not manager.reachable, manager.readings.loaded_at, data)


@dataclass(frozen=True)
class SavedPreset:
    """A preset save as the API answers it: the name stored, and ``warning`` when the daemon mirror did not land."""

    name: str
    warning: str | None = None

    @classmethod
    def of(cls, result: PresetSaveResult) -> "SavedPreset":
        """Word a save's mirror outcome for the wire; a mirror that landed carries no warning."""
        if result.mirror is MirrorOutcome.NOT_LANDED:
            return cls(result.name, warning="hqplayerd's own profile list was not updated")
        return cls(result.name)


@dataclass(frozen=True)
class WithAutosave[T]:
    """A write's report, and the auto-save fold that followed it: None when auto-save was off or nothing was folded."""

    report: T
    autosaved: SavedPreset | None

    @classmethod
    def from_json(cls, body: Mapping[str, object]) -> "WithAutosave[object]":
        """Read an answer back into its two halves: the report, and the fold."""
        folded = body["autosaved"]
        if not isinstance(folded, Mapping):
            return WithAutosave(body["report"], None)
        name, warning = folded.get("name"), folded.get("warning")
        autosaved = SavedPreset(
            name=name if isinstance(name, str) else "",
            warning=warning if isinstance(warning, str) else None,
        )
        return WithAutosave(body["report"], autosaved)


@dataclass(frozen=True)
class WithSaved[T]:
    """A write's report, and the named preset save that followed it."""

    report: T
    saved: SavedPreset


@contextlib.contextmanager
def preset_refusals() -> Iterator[None]:
    """Refuse a preset load, save or auto-save the daemon failed, with the code a load answers.

    ``ControlError`` and ``PresetError`` carry their own codes to the registered handler; the two failures that do
    not are mapped here, so every preset write answers a daemon failure the same way.
    """
    try:
        yield
    except httpx.HTTPError as exc:
        raise refuse(DaemonReadFailedError(error=exc)) from exc
    except GroundingError as exc:
        raise refuse(InvalidInputError(error=exc)) from exc


async def with_autosave[T](report: T, manager: ConnectionManager) -> WithAutosave[T]:
    """Fold a clean write into the active preset when auto-save is armed, and carry the fold beside the report.

    A fold that fails refuses the request with the save's own code, as a standalone save does.
    """
    with preset_refusals():
        autosaved = await presetlane.autosave(manager)
    return WithAutosave(report, None if autosaved is None else SavedPreset.of(autosaved))


def ensure_form[F](form: F | None, error: str | None, label: str) -> F:
    """Return a polled 8088 form, or the honest reason it is missing.

    502 when the fetch itself failed (the daemon answered badly), 503 when nothing has been loaded yet (the first poll
    has not landed). Returns the form so callers can build a response off it without re-checking for None. ``F`` is
    presence, never shape: the form's own snapshot type rides through unchanged.
    """
    if form is not None:
        return form
    if error:
        raise refuse(GetFormFailedError(label=label, error=error))
    raise refuse(NotLoadedError())
