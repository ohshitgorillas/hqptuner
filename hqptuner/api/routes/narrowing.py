"""Narrowing REST surface — the narrow bar's facets, shared by every browser pointed at this install.

Two routes and no daemon: narrowing is presentational, HQPTuner's own record of which filters the dropdowns offer, so
nothing here touches the control lane, the http lane, or the pending store. Both routes answer with the whole facet
set, because the client's state is the whole bar and a partial answer would leave it guessing.
"""

from dataclasses import dataclass

from fastapi import APIRouter, Request
from pydantic import BaseModel

from hqptuner.presets.store.narrowing import (
    Facets,
    NarrowingStore,
)

router = APIRouter(prefix="/api")


class FacetBody(BaseModel, extra="forbid"):
    """A facet map on the wire: one optional field per key ``FacetInput`` names; any other key is a 422."""

    genre: list[str] | None = None
    genre_mode: str | None = None
    quality: int | None = None
    focus: list[str] | None = None
    focus_mode: str | None = None
    phase: list[str] | None = None
    length: list[str] | None = None
    hide_limited: str | None = None
    odd_rate_only: bool | None = None
    downsafe_only: bool | None = None
    apod_1x: str | None = None
    apod_nx: str | None = None
    lossy_1x: str | None = None
    src_format: str | None = None


class NarrowingBody(BaseModel):
    """The whole facet set for ``PUT /api/narrowing``."""

    facets: FacetBody


@dataclass(frozen=True)
class NarrowingAnswer:
    """Both narrowing routes' answer: the whole facet set as stored."""

    facets: Facets


def _store(request: Request) -> NarrowingStore:
    store: NarrowingStore = request.app.state.narrowing
    return store


@router.get("/narrowing")
def narrowing(request: Request) -> NarrowingAnswer:
    """Every narrow-bar facet, stored value or default.

    409 when the store on disk is stamped newer than this HQPTuner reads — answering with defaults would be a lie
    about a file that is there and full.
    """
    facets = _store(request).read()
    return NarrowingAnswer(facets)


@router.put("/narrowing")
def save_narrowing(body: NarrowingBody, request: Request) -> NarrowingAnswer:
    """Replace the whole facet set with the facets given, and answer with what was stored.

    Whole-set replace: a facet left out is stored at its default, so the client never needs a second route and two
    browsers racing is last-write-wins rather than a merge nobody asked for.

    422s a facet key ``FacetBody`` does not name — pydantic's own ``extra="forbid"`` refuses it at the door.
    """
    facets = _store(request).write(body.facets.model_dump(exclude_none=True))
    return NarrowingAnswer(facets)
