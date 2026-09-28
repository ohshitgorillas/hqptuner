"""Refresh of the three polled 8088 forms — /config, /matrix and /speakers.

It sits with
the lanes because it is the same shape as they are: a function over the manager
that owns one slice of the daemon conversation, here the read side of the HTTP
lane the manager polls on every tick.
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

    from hqptuner.conf.httpforms import ConfigForm, MatrixForm, SpeakersForm
    from hqptuner.core.manager import ConnectionManager


async def refresh(mgr: ConnectionManager) -> FormsRefresh:
    """Best-effort refresh of the /config, /matrix and /speakers snapshots, answering what the pass did.

    A wire failure on the 8088 lane must never fail the 4321 poll — the last-good form is
    kept and only that form's error is recorded. That tolerance is for the daemon being
    unreachable or answering non-2xx, not for a parser of ours raising: an ``AttributeError``
    out of ``parse_config_form`` is our bug, and recording it as this form's error would
    hide it behind a message that reads like the daemon's fault. Anything but ``httpx.HTTPError``
    (which ``AuthRefused`` subclasses) propagates.

    Each polled form is one row of ``getters`` (its readings attribute, its error
    attribute, its getter), and one ``try``/``except`` serves every row. The getters
    are bound methods, so each one is referenced statically and a getter no row
    names reads as unused.

    The per-form ``except`` clause below only records the wire fact (the failing
    route's own error text) as a side effect on ``readings`` — never a value this
    function turns around and returns. ``FormsOutcome`` is decided by ``_outcome``,
    after the loop, from state: how many of the three came back, and whether the
    daemon refused the credentials, which the client records where it detects it.
    """
    http = mgr.http_client
    if http is None:
        return FormsRefresh(FormsOutcome.NO_CREDENTIALS)
    getters: tuple[tuple[str, str, Callable[[], Awaitable[ConfigForm | MatrixForm | SpeakersForm]]], ...] = (
        ("config_form", "config_error", http.get_config),
        ("matrix_form", "matrix_error", http.get_matrix),
        ("speakers_form", "speakers_error", http.get_speakers),
    )
    fetched = 0
    for form_attr, error_attr, getter in getters:
        try:
            form = await getter()
        except httpx.HTTPError as exc:
            setattr(mgr.readings, error_attr, str(exc))
            continue
        fetched += 1
        if form_attr == "config_form":
            # Against the form as it stands at THIS instant, never a snapshot taken
            # when the refresh began: the poll loop and a route can both be inside
            # this function at once, and a comparison against the pre-fetch value
            # then records the same landing once per caller. Read and write with no
            # await between them, which is what makes the pair atomic. The startup
            # volume's baseline in the browser is this form rather than the config
            # file, so a form that reported the wrong number for one tick is
            # otherwise untraceable.
            landing = voltrace.form_subset(form)
            voltrace.observe_change(mgr, "config_form", landing, voltrace.form_subset(mgr.readings.config_form))
        setattr(mgr.readings, form_attr, form)
        setattr(mgr.readings, error_attr, None)
    if http.credentials_ok is not None:
        _record_credentials(mgr, accepted=http.credentials_ok)
    return FormsRefresh(_outcome(mgr, fetched, len(getters)))


def _outcome(mgr: ConnectionManager, fetched: int, total: int) -> FormsOutcome:
    """Decide what this pass answers, from state alone — never from a caught exception.

    A refusal outranks a partial fetch: the three pages share one credential, so a
    refusal recorded this pass (or still standing from one before it — the same
    tolerance ``_record_credentials`` already keeps) is the pass's answer over a
    plain wire count.
    """
    if mgr.readings.credentials_ok is False:
        return FormsOutcome.REFUSED
    if fetched == total:
        return FormsOutcome.OK
    return FormsOutcome.NO_ANSWER


def _record_credentials(mgr: ConnectionManager, *, accepted: bool) -> None:
    """Record what the 8088 lane just proved about the credentials, logging only the transition.

    Per poll would put the same line in the log every two seconds for as long as
    the install stays broken, which is how a real report gets scrolled past.
    """
    if mgr.readings.credentials_ok is accepted:
        return
    mgr.readings.credentials_ok = accepted
    if accepted:
        log.info("hqplayerd management credentials accepted")
    else:
        log.warning("%s", httpauth.AUTH_REFUSED_MESSAGE)
