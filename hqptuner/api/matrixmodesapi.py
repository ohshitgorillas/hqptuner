"""Per-preset Matrix-tab mode REST surface — which half of the Matrix tab a preset is listened through.

Two routes and no daemon: the mode is HQPTuner's own record, keyed by preset name, so nothing here touches the control
lane, the http lane, or the pending store. Both routes answer with the whole map, because the client renders whichever
preset it is looking at and a partial answer would leave it guessing about the rest.

The name travels in the BODY rather than the path, the way a description's does: a preset name is free text the user
typed, slashes and all, and a path segment would make the route's shape depend on what they called it.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from hqptuner.presets.matrixmodestore import MatrixModeError, MatrixModeSchemaError, MatrixModeStore

router = APIRouter(prefix="/api")


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
    try:
        return {"presets": _store(request).read()}
    except MatrixModeSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/matrixmodes")
def save_matrix_mode(body: MatrixModeBody, request: Request) -> dict[str, dict[str, str]]:
    """Store one preset's Matrix-tab mode and answer with the whole map.

    One preset per write rather than the whole map: two browsers looking at different presets is ordinary, and a
    whole-map replace would make one of them undo the other's choice.
    """
    try:
        return {"presets": _store(request).write(body.name, body.mode)}
    except MatrixModeSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MatrixModeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
