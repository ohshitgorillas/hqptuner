"""One shape for every refusal the API sends: ``{"detail": ..., "code": ...}``.

``detail`` is FastAPI's field and stays what it was, a sentence or the live
lane's per-field reasons dict, so nothing reading it changes. ``code`` is the
new half: a stable identifier from the table below that a client acts on
without parsing the sentence. The status is a property of the code, not of the
raise site, so a route names the cause and the table answers the status; a
code missing from the table is a programming error and fails loudly.
"""

from __future__ import annotations

from typing import Any, cast

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from hqptuner.errors import HQPTunerError

# code -> HTTP status. Every code the API can answer with is here; the
# vocabulary is documented for clients in docs/architecture.md "API errors".
STATUS: dict[str, int] = {
    "no_credentials": 503,
    "not_loaded": 503,
    "daemon_read_failed": 502,
    "daemon_write_failed": 502,
    "daemon_unavailable": 503,
    "daemon_refused": 503,
    "not_found": 404,
    "name_invalid": 422,
    "invalid_input": 422,
    "nothing_staged": 400,
    "fields_unknown": 422,
    "store_too_new": 409,
    "chain_unknown": 409,
    "route_refused": 409,
    "route_unknown": 404,
    "method_not_allowed": 405,
}

# The two refusals the framework raises on its own, before any route runs: no
# route at that path, and a real path hit with the wrong method. Keyed by the
# status the router raised, since that is all it says; STATUS still owns the
# status of each code.
_FRAMEWORK_CODES: dict[int, str] = {404: "route_unknown", 405: "method_not_allowed"}


class ApiError(HTTPException):
    """An ``HTTPException`` that also knows its code; the handler below renders both."""

    def __init__(self, code: str, detail: Any) -> None:
        """Answer with the status ``code`` maps to, ``detail`` unchanged, ``code`` beside it."""
        super().__init__(status_code=STATUS[code], detail=detail)
        self.code = code


def refuse(cause: HQPTunerError | str, detail: Any = None) -> ApiError:
    """Build the refusal for ``cause``: an exception (its code and message) or a bare code with ``detail``.

    ``detail`` given with an exception replaces its message, for the live lane's
    reasons dict; given with a bare code it is the sentence to show.
    """
    if isinstance(cause, HQPTunerError):
        return ApiError(cause.code, str(cause) if detail is None else detail)
    return ApiError(cause, detail)


async def _render(_: Request, exc: Exception) -> Response:
    # Registered for ApiError only; starlette types every handler over Exception.
    err = cast("ApiError", exc)
    return JSONResponse({"detail": err.detail, "code": err.code}, status_code=err.status_code)


async def _render_framework(request: Request, exc: Exception) -> Response:
    # Registered for starlette's HTTPException: the router's own 404 and 405
    # get the shared shape and their code; anything else keeps FastAPI's default.
    err = cast("StarletteHTTPException", exc)
    code = _FRAMEWORK_CODES.get(err.status_code)
    if code is None:
        return await http_exception_handler(request, err)
    return JSONResponse({"detail": err.detail, "code": code}, status_code=err.status_code, headers=err.headers)


def install(app: FastAPI) -> None:
    """Register the renderers so every refusal, the framework's own included, answers in the shared shape."""
    app.add_exception_handler(ApiError, _render)
    app.add_exception_handler(StarletteHTTPException, _render_framework)
