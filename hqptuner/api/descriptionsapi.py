"""Profile-description REST surface — what the user wrote about a saved matrix profile.

Two routes and no daemon: a description is HQPTuner's own record, keyed by profile name, so nothing here touches the
control lane, the http lane, or the pending store. Both routes answer with the whole map, because the client renders
whichever profile it is looking at and a partial answer would leave it guessing about the rest.

The name travels in the BODY rather than the path: a matrix profile's name is free text the user typed, slashes and
all, and a path segment would make the route's shape depend on what they called it.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from hqptuner.presets.descriptionstore import DescriptionError, DescriptionSchemaError, DescriptionStore

router = APIRouter(prefix="/api")


class DescriptionBody(BaseModel):
    """One profile's description for ``PUT /api/descriptions``.

    A sibling surface keeps its own body (``models`` is the main surface's). Empty text is a legal body and means the
    user cleared the description — the store turns that into a removal.
    """

    name: str
    text: str


def _store(request: Request) -> DescriptionStore:
    store: DescriptionStore = request.app.state.descriptions
    return store


@router.get("/descriptions")
def descriptions(request: Request) -> dict[str, dict[str, dict[str, str]]]:
    """Every stored profile description, keyed by profile name.

    409 when the store on disk is stamped newer than this HQPTuner reads — an empty map would be a lie about a file
    that is there and full.
    """
    try:
        return {"profiles": _store(request).read()}
    except DescriptionSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put("/descriptions")
def save_description(body: DescriptionBody, request: Request) -> dict[str, dict[str, dict[str, str]]]:
    """Store one profile's description and answer with the whole map.

    One profile per write rather than the whole map, unlike favorites: a description is long, two browsers editing
    different profiles is ordinary, and a whole-map replace would make one of them lose the other's paragraph.
    """
    try:
        return {"profiles": _store(request).write(body.name, body.text)}
    except DescriptionSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DescriptionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
