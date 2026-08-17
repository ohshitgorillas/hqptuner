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
    """The whole set of starred filter names for ``PUT /api/favorites``.

    A sibling surface keeps its own body (``models`` is the main surface's), and this one is a single field: the
    client sends the set it wants stored, not a diff against the set it last read.
    """

    filters: list[str]


def _store(request: Request) -> FavoriteStore:
    store: FavoriteStore = request.app.state.favorites
    return store


@router.get("/favorites")
def favorites(request: Request) -> dict[str, list[str]]:
    """Every starred filter name, sorted.

    409 when the store on disk is stamped newer than this HQPTuner reads — an empty list would be a lie about a file
    that is there and full.
    """
    try:
        return {"filters": _store(request).read()}
    except FavoriteSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/favorites")
def save_favorites(body: FavoritesBody, request: Request) -> dict[str, list[str]]:
    """Replace the whole set of stars with the names given, and answer with what was stored.

    Whole-set replace: unstarring is a write without the name, so the client never needs a second route and two
    browsers racing is last-write-wins rather than a merge nobody asked for.
    """
    try:
        return {"filters": _store(request).write(list(body.filters))}
    except FavoriteSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FavoriteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
