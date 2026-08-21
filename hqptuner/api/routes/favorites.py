"""Favorites REST surface — the stars on filter names, shared by every browser pointed at this install.

Two routes and no daemon: a favorite is HQPTuner's own record of what the user likes, so nothing here touches the
control lane, the http lane, or the pending store. Both routes answer with the whole list, because the client's state
is a set and a partial answer would leave it guessing.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from hqptuner.presets.store.favorites import FavoriteError, FavoriteSchemaError, FavoriteStore

router = APIRouter(prefix="/api")


class FavoritesBody(BaseModel):
    """The starred names for ``PUT /api/favorites`` — the filter set, the modulator set, or both.

    A sibling surface keeps its own body (``models`` is the main surface's). Each field the body carries is the whole
    set the client wants stored for that kind, not a diff against the set it last read. A field the body omits is left
    alone: absent means "not part of this write", never "empty it", so a client that knows only about filters cannot
    wipe the modulator stars.
    """

    filters: list[str] | None = None
    modulators: list[str] | None = None


def _store(request: Request) -> FavoriteStore:
    store: FavoriteStore = request.app.state.favorites
    return store


@router.get("/favorites")
def favorites(request: Request) -> dict[str, list[str]]:
    """Every starred filter and modulator name, each sorted.

    409 when the store on disk is stamped newer than this HQPTuner reads — an empty list would be a lie about a file
    that is there and full.
    """
    store = _store(request)
    try:
        return {"filters": store.read(), "modulators": store.read_modulators()}
    except FavoriteSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/favorites")
def save_favorites(body: FavoritesBody, request: Request) -> dict[str, list[str]]:
    """Replace the sets the body carries, and answer with both stored lists.

    Whole-set replace per kind: unstarring is a write without the name, so the client never needs a second route and
    two browsers racing is last-write-wins rather than a merge nobody asked for. A kind the body omits is not written,
    so the answer reports it as it already stood; a body naming neither kind is not a write at all and is refused
    rather than answered with a silent no-op.
    """
    store = _store(request)
    if body.filters is None and body.modulators is None:
        raise HTTPException(status_code=422, detail="favorites write names no set: send filters, modulators, or both")
    try:
        if body.filters is not None:
            store.write(list(body.filters))
        if body.modulators is not None:
            store.write_modulators(list(body.modulators))
        return {"filters": store.read(), "modulators": store.read_modulators()}
    except FavoriteSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FavoriteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
