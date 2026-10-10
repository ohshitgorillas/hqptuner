"""Per-preset Matrix-tab mode REST surface — which half of the Matrix tab a preset is listened through.

Two routes and no daemon: the mode is HQPTuner's own record, keyed by preset name, so nothing here touches the control
lane, the http lane, or the pending store. Both routes answer with the whole map, because the client renders whichever
preset it is looking at and a partial answer would leave it guessing about the rest.

The name travels in the BODY rather than the path, the way a description's does: a preset name is free text the user
typed, slashes and all, and a path segment would make the route's shape depend on what they called it.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from hqptuner.api.deps import Mgr
from hqptuner.api.errors import ErrorBody, refuse
from hqptuner.presets import names
from hqptuner.presets.store.matrixmode import (
    InvalidPresetNameError,
    MatrixModeStore,
    validate_mode,
)

router = APIRouter(prefix="/api")


class NoSuchPresetError(ErrorBody):
    """A Matrix-tab mode names a preset the preset store does not carry."""

    code = "not_found"

    def __init__(self, *, name: str) -> None:
        """Render the wording naming the unrecognized preset ``name``."""
        super().__init__(f"no such preset: {name!r}")


class MatrixModeBody(BaseModel):
    """One preset's Matrix-tab mode for ``PUT /api/matrixmodes``.

    A sibling surface keeps its own body (``models`` is the main surface's). The mode is validated by the store rather
    than by the type, so an unknown value answers 422 naming what is storable instead of a schema complaint.
    """

    name: str
    mode: str


def _store(request: Request) -> MatrixModeStore:
    store: MatrixModeStore = request.app.state.matrix_modes
    return store


@router.get("/matrixmodes")
def matrix_modes(request: Request) -> dict[str, dict[str, str]]:
    """Every stored Matrix-tab mode, keyed by preset name.

    409 when the store on disk is stamped newer than this HQPTuner reads — an empty map would be a lie about a file
    that is there and full, and would put the user on the wrong half of the tab.
    """
    return {"presets": _store(request).read()}


@router.put("/matrixmodes")
def save_matrix_mode(body: MatrixModeBody, request: Request, manager: Mgr) -> dict[str, dict[str, str]]:
    """Store one preset's Matrix-tab mode and answer with the whole map.

    One preset per write rather than the whole map: two browsers looking at different presets is ordinary, and a
    whole-map replace would make one of them undo the other's choice.

    404 on a name the preset store does not carry: a mode keyed to no preset is one nothing will ever read back. The
    mode is judged before the name, so a request that is wrong in both ways is still told what is storable.
    """
    store = _store(request)
    validate_mode(body.mode)
    name = names.validate_name(body.name, InvalidPresetNameError, "preset")
    if name not in manager.presetops.store.names():
        raise refuse(NoSuchPresetError(name=name))
    return {"presets": store.write(name, body.mode)}
