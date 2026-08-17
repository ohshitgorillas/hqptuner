"""Narrowing REST surface — the narrow bar's facets, shared by every browser pointed at this install.

Two routes and no daemon: narrowing is presentational, HQPTuner's own record of which filters the dropdowns offer, so
nothing here touches the control lane, the http lane, or the pending store. Both routes answer with the whole facet
set, because the client's state is the whole bar and a partial answer would leave it guessing.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from hqptuner.presets.store.narrowing import NarrowingError, NarrowingSchemaError, NarrowingStore

router = APIRouter(prefix="/api")


class NarrowingBody(BaseModel):
    """The whole facet set for ``PUT /api/narrowing``.

    Deliberately untyped per facet: the store owns the domains, so a bad token comes back as its sentence naming the
    facet rather than as pydantic's shape complaint about a dict.
    """

    facets: dict[str, Any]


def _store(request: Request) -> NarrowingStore:
    store: NarrowingStore = request.app.state.narrowing
    return store


@router.get("/narrowing")
def narrowing(request: Request) -> dict[str, dict[str, Any]]:
    """Every narrow-bar facet, stored value or default.

    409 when the store on disk is stamped newer than this HQPTuner reads — answering with defaults would be a lie
    about a file that is there and full.
    """
    try:
        return {"facets": _store(request).read()}
    except NarrowingSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/narrowing")
def save_narrowing(body: NarrowingBody, request: Request) -> dict[str, dict[str, Any]]:
    """Replace the whole facet set with the facets given, and answer with what was stored.

    Whole-set replace: a facet left out is stored at its default, so the client never needs a second route and two
    browsers racing is last-write-wins rather than a merge nobody asked for.
    """
    try:
        return {"facets": _store(request).write(dict(body.facets))}
    except NarrowingSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except NarrowingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
