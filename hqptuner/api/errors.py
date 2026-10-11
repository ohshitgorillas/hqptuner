"""One shape for every refusal the API sends: ``{"detail": ..., "code": ...}``.

``detail`` is FastAPI's standard field, a sentence or the live lane's
per-field reasons dict, so a client reading FastAPI's default error shape
reads it as is. ``code`` is a stable identifier from the table below that a
client acts on without parsing the sentence. The status is a property of the code, not of the
raise site, so a route names the cause and the table answers the status; a
code missing from the table is a programming error and fails loudly.

A route never composes the sentence at the raise site: it hands ``refuse`` an
``ErrorBody`` (one class per wording, keyword constructor) or an
``HQPTunerError`` it already caught.
"""

from __future__ import annotations

import inspect
import logging
from typing import TYPE_CHECKING, ClassVar

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from hqptuner.errors import HQPTunerError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from hqptuner.engine.controlerrors import ControlError

# code -> HTTP status. Every code the API can answer with is here; the
# vocabulary is documented for clients in docs/spec/architecture.md "API errors".
STATUS: dict[str, int] = {
    "no_credentials": 503,
    "no_http_client": 503,
    "backup_failed": 500,
    "not_loaded": 503,
    "daemon_read_failed": 502,
    "daemon_log_absent": 404,
    "daemon_write_failed": 502,
    "daemon_unavailable": 503,
    "daemon_refused": 503,
    "not_found": 404,
    "name_invalid": 422,
    "invalid_input": 422,
    "nothing_staged": 400,
    "fields_unknown": 422,
    "values_unknown": 422,
    "stations_unknown": 422,
    "store_too_new": 409,
    "store_corrupt": 500,
    "store_unwritable": 500,
    "archive_unreadable": 500,
    "state_unreadable": 422,
    "state_too_new": 409,
    "chain_unknown": 409,
    "route_refused": 409,
    "route_unknown": 404,
    "method_not_allowed": 405,
    "internal_error": 500,
}

# The two refusals the framework raises on its own, before any route runs: no
# route at that path, and a real path hit with the wrong method. Keyed by the
# status the router raised, since that is all it says; STATUS still owns the
# status of each code.
_FRAMEWORK_CODES: dict[int, str] = {404: "route_unknown", 405: "method_not_allowed"}

log = logging.getLogger(__name__)

# What ``detail`` renders as: FastAPI's own field, either the sentence or the live lane's per-field reasons dict.
type ErrorDetail = str | dict[str, str]


class ErrorBody:
    """A refusal not raised from an ``HQPTunerError``: a fixed API ``code`` and a rendered ``detail``.

    Subclassed once per wording, next to the facts it names.
    """

    code: str

    def __init__(self, detail: ErrorDetail) -> None:
        """Carry the rendered ``detail`` this refusal answers with."""
        self.detail = detail


class ControlFailedError(ErrorBody):
    """A Control API error under the code it was raised with, its text led by the subclass's ``template``.

    The route's lead clause says what HQPTuner was doing; the text after it is the error's own, unchanged, and so is
    its code. Subclassed once per route, next to the route, with a ``template`` carrying ``{error}``.
    """

    template: ClassVar[str]

    def __init__(self, *, error: ControlError) -> None:
        """Render ``template`` around ``error``'s own text, and answer under ``error``'s own code."""
        super().__init__(self.template.format(error=error))
        self.code = error.code


class NotLoadedError(ErrorBody):
    """Nothing has been read from the daemon on this snapshot yet."""

    code = "not_loaded"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPTuner has not read HQPlayer's settings yet. Try again in a few seconds.")


class InvalidInputError(ErrorBody):
    """A caught exception whose own message is the whole refusal, unembellished."""

    code = "invalid_input"

    def __init__(self, *, error: Exception) -> None:
        """Render ``error``'s own message, naming no further fact."""
        super().__init__(str(error))


class DaemonReadFailedError(ErrorBody):
    """A daemon read that failed, whose own message is the whole refusal, unembellished."""

    code = "daemon_read_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render ``error``'s own message, naming no further fact."""
        super().__init__(str(error))


class InternalError(ErrorBody):
    """An exception no other handler maps: a defect, whose traceback is in the log rather than the answer."""

    code = "internal_error"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPTuner hit an unexpected error. The details are in its log.")


class ApiError(HTTPException):
    """An ``HTTPException`` that also knows its code; the handler below renders both."""

    def __init__(self, code: str, detail: ErrorDetail) -> None:
        """Answer with the status ``code`` maps to, ``detail`` unchanged, ``code`` beside it."""
        super().__init__(status_code=STATUS[code], detail=detail)
        self.code = code


def refuse(cause: ErrorBody | HQPTunerError, detail: dict[str, str] | None = None) -> ApiError:
    """Build the refusal for ``cause``: an ``ErrorBody`` (its own code and detail) or an ``HQPTunerError``.

    ``detail`` is for the live lane's per-field reasons dict, overriding an ``HQPTunerError``'s own message; an
    ``ErrorBody`` already carries its rendered detail and takes none.
    """
    if isinstance(cause, HQPTunerError):
        return ApiError(cause.code, str(cause) if detail is None else detail)
    return ApiError(cause.code, cause.detail)


def _handler[ExcT: Exception](
    kind: type[ExcT], render: Callable[[Request, ExcT], Response | Awaitable[Response]]
) -> Callable[[Request, Exception], Awaitable[Response]]:
    """Wrap ``render`` — which assumes its ``exc`` is already a ``kind`` — as a handler Starlette can register.

    Starlette dispatches by the exact class it was registered under, so the isinstance always holds at runtime;
    this is the one place that says so, and the one place that re-raises otherwise. ``render`` may answer sync or async
    (``_render_framework`` awaits the framework's own handler), so this always awaits and only bridges the sync case.
    """

    async def dispatch(request: Request, exc: Exception) -> Response:
        if isinstance(exc, kind):
            result = render(request, exc)
            return await result if inspect.isawaitable(result) else result
        raise exc

    return dispatch


def _render(_: Request, exc: ApiError) -> Response:
    return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status_code)


async def _render_framework(request: Request, exc: StarletteHTTPException) -> Response:
    # The router's own 404 and 405 get the shared shape and their code; anything else keeps FastAPI's default.
    code = _FRAMEWORK_CODES.get(exc.status_code)
    if code is None:
        return await http_exception_handler(request, exc)
    path = request.url.path
    detail = (
        f"This HQPTuner has no {path}. Reload the page."
        if code == "route_unknown"
        else f"This HQPTuner cannot {request.method} {path}. Reload the page."
    )
    return JSONResponse({"detail": detail, "code": code}, status_code=exc.status_code, headers=exc.headers)


def _render_error(_: Request, exc: HQPTunerError) -> Response:
    # One no route turned into a refusal (a corrupt store read on a path that
    # never expected one) still answers in the shared shape, at the status its
    # code maps to.
    return JSONResponse({"detail": str(exc), "code": exc.code}, status_code=STATUS.get(exc.code, 500))


def _render_unexpected(request: Request, exc: Exception) -> Response:
    # Logged here, through the root logger, because the server's own report of the
    # re-raise goes to uvicorn's logger and never reaches the in-memory ring.
    log.error("unexpected error on %s %s", request.method, request.url.path, exc_info=exc)
    body = InternalError()
    return JSONResponse({"detail": body.detail, "code": body.code}, status_code=STATUS[body.code])


def install(app: FastAPI) -> None:
    """Register the renderers so every refusal, the framework's own included, answers in the shared shape.

    An ``HQPTunerError`` that escapes a route renders the same way, under its own code; any other exception
    answers ``internal_error`` and logs its traceback.
    """
    app.add_exception_handler(ApiError, _handler(ApiError, _render))
    app.add_exception_handler(StarletteHTTPException, _handler(StarletteHTTPException, _render_framework))
    app.add_exception_handler(HQPTunerError, _handler(HQPTunerError, _render_error))
    app.add_exception_handler(Exception, _handler(Exception, _render_unexpected))
