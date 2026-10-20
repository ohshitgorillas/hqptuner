"""Refresh of the three polled 8088 forms — /config, /matrix and /speakers.

It sits with
the lanes because it is the same shape as they are: a function over the manager
that owns one slice of the daemon conversation, here the read side of the HTTP
lane the loader refreshes on its poll interval.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

import httpx

from hqptuner import voltrace
from hqptuner.conf import httpauth

log = logging.getLogger(__name__)


class FormsOutcome(StrEnum):
    """What a refresh did overall.

    The individual forms report their own errors into `readings` and are not part of this answer: a daemon
    answering /config while /matrix is unhappy is not a connection fault. Callers that only want the
    snapshots filled ignore it. It is this pass's own verdict, which a refusal recorded in `readings`
    cannot give: that one cannot be told apart from one recorded a poll earlier.
    """

    NO_CREDENTIALS = "no_credentials"
    REFUSED = "refused"
    OK = "ok"
    NO_ANSWER = "no_answer"


@dataclass(frozen=True)
class FormsRefresh:
    """What ``refresh`` did, as ``FormsOutcome`` (see that type's docstring)."""

    outcome: FormsOutcome


if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from hqptuner.conf.httpforms import ConfigForm, SpeakersForm
    from hqptuner.lanes import LaneManager


async def refresh(mgr: LaneManager) -> FormsRefresh:
    """Best-effort refresh of the /config, /matrix and /speakers snapshots, answering what the pass did.

    A wire failure on the 8088 lane must never fail the 4321 poll — the last-good form is
    kept and only that form's error is recorded. That tolerance is for the daemon being
    unreachable or answering non-2xx, not for a parser of ours raising: an ``AttributeError``
    out of ``parse_config_form`` is our bug, and recording it as this form's error would
    hide it behind a message that reads like the daemon's fault. Anything but ``httpx.HTTPError``
    (which ``AuthRefused`` subclasses) propagates.

    Each form is fetched by ``_fetch`` and taken into ``readings`` as one File reading
    of its page, the form with its error, before the next page is fetched.

    The wire fact a failed fetch yields (the failing route's own error text) is only
    recorded on ``readings`` — never a value this function turns around and returns.
    ``FormsOutcome`` is decided by ``_outcome``, after the three pages, from state: how
    many of the three came back, and whether the daemon refused the credentials, which
    the client records where it detects it.
    """
    http = mgr.http_client
    if http is None:
        return FormsRefresh(FormsOutcome.NO_CREDENTIALS)
    readings = mgr.readings
    await _fetch(http.get_config, lambda form: _take_config(mgr, form), lambda e: readings.take_file(config_error=e))
    await _fetch(
        http.get_matrix,
        lambda form: readings.take_file(matrix_form=form, matrix_error=None),
        lambda e: readings.take_file(matrix_error=e),
    )
    await _fetch(
        http.get_speakers,
        lambda form: take_speakers(mgr, form),
        lambda e: readings.take_file(speakers_error=e),
    )
    if http.credentials_ok is not None:
        record_credentials(mgr, accepted=http.credentials_ok)
    return FormsRefresh(_outcome(mgr))


def _take_config(mgr: LaneManager, config: ConfigForm) -> None:
    """Take the /config form into ``readings``, tracing the volume it landed on."""
    readings = mgr.readings
    # Compared against the form as it stands at this instant: the poll loop
    # and a route can both be inside this function at once, and each caller
    # records a landing only against the value it reads here. Read and write with no
    # await between them, which is what makes the pair atomic. The startup
    # volume's baseline in the browser is this form rather than the config
    # file, so a form that reported the wrong number for one tick is
    # otherwise untraceable.
    landing = voltrace.form_subset(config)
    voltrace.observe_change(mgr, "config_form", landing, voltrace.form_subset(readings.config_form))
    readings.take_file(config_form=config, config_error=None)


async def _fetch[F](
    getter: Callable[[], Awaitable[F]], take: Callable[[F], object], fail: Callable[[str], object]
) -> None:
    """Fetch one form and hand it to ``take``, or on a wire failure hand the failure's text to ``fail``."""
    try:
        form = await getter()
    except httpx.HTTPError as exc:
        fail(str(exc))
    else:
        take(form)


def _outcome(mgr: LaneManager) -> FormsOutcome:
    """Decide what this pass answers, from state alone — never from a caught exception.

    A refusal outranks a partial fetch: the three pages share one credential, so a
    refusal recorded this pass (or still standing from one before it — the same
    tolerance ``record_credentials`` already keeps) is the pass's answer over a
    plain wire count.
    """
    if mgr.readings.credentials_ok is False:
        return FormsOutcome.REFUSED
    readings = mgr.readings
    if readings.config_error is None and readings.matrix_error is None and readings.speakers_error is None:
        return FormsOutcome.OK
    return FormsOutcome.NO_ANSWER


def record_credentials(mgr: LaneManager, *, accepted: bool) -> None:
    """Record what the 8088 lane just proved about the credentials, logging only the transition.

    The one writer of ``readings.credentials_ok``: the poll records the client's verdict here, and a restore pass
    the daemon refused records its refusal here.

    Per poll would put the same line in the log every two seconds for as long as
    the install stays broken, which is how a real report gets scrolled past.
    """
    if not mgr.readings.take_file(credentials_ok=accepted):
        return
    if accepted:
        log.info("hqplayerd management credentials accepted")
    else:
        log.warning("%s", httpauth.AUTH_REFUSED_MESSAGE)


def take_speakers(mgr: LaneManager, form: SpeakersForm) -> None:
    """Take the /speakers form the daemon just answered into ``readings``, clearing that page's error.

    The one writer of ``readings.speakers_form``: the poll records each page it fetched here, and a speaker apply
    records its re-read here.
    """
    mgr.readings.take_file(speakers_form=form, speakers_error=None)


def decline(mgr: LaneManager) -> httpauth.HttpLaneDeclinedError | None:
    """Return the refusal a use of the 8088 lane would meet for ``mgr``, or None when it is usable.

    Read off the client the manager holds and the credential verdict this module records.
    """
    return httpauth.decline_error(
        has_client=mgr.http_client is not None, credentials_refused=mgr.readings.credentials_ok is False
    )
