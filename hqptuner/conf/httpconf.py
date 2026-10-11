"""hqplayerd HTTP configuration interface (port 8088) — transport and writes.

``HttpConfigClient`` is the Digest-authenticated client for the /config, /matrix,
/speakers and /backup forms; each read parses the page it fetched unless the
body is byte-identical to the one that getter fetched last, and each
write serializes a complete form (the daemon silently ignores a partial POST)
with the daemon's checkbox and range-validation contracts.
"""

import contextlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup, Tag

from hqptuner.conf.formparse import attr, parse_config_form, parse_matrix_form, parse_speakers_form
from hqptuner.conf.httpauth import AuthRefused, raise_for_status
from hqptuner.conf.httpforms import ConfigForm, MatrixForm, SpeakersForm
from hqptuner.conf.noanswer import http_deadline

# readme §1.9.1: level is dBFS, distance is cm. Ranges from the live form inputs.
_SPK_LEVEL = (-60.0, 0.0)
_SPK_DISTANCE = (0.0, 5000.0)


class SpeakerValueNotNumericError(ValueError):
    """A staged speaker field did not parse as a number at all."""

    def __init__(self, *, field: str, value: str) -> None:
        """Render the wording naming the field and the non-numeric value it was given."""
        super().__init__(f"speakers: {field}={value!r} is not numeric")


class SpeakerValueOutOfRangeError(ValueError):
    """A staged speaker field parsed but fell outside its allowed range."""

    def __init__(self, *, field: str, value: str, bounds: tuple[float, float]) -> None:
        """Render the wording naming the field, the rejected value, and the bounds it must fall in."""
        lo, hi = bounds
        super().__init__(f"speakers: {field}={value} out of range [{lo:g}, {hi:g}]")


def _validate_speaker_num(value: str, bounds: tuple[float, float], field: str) -> str:
    """Numeric + in-range or raise.

    Returns the caller's exact string so a 0.1 level step survives verbatim —
    garbage never reaches the daemon.
    """
    lo, hi = bounds
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise SpeakerValueNotNumericError(field=field, value=value) from None
    if not (lo <= n <= hi):
        raise SpeakerValueOutOfRangeError(field=field, value=value, bounds=bounds)
    return value


def serialize_matrix_form(html: str) -> tuple[dict[str, str], list[str]]:
    """Complete, browser-faithful serialization of the /matrix form.

    Checked checkboxes only (submitting their ``value`` attr — the daemon
    persists a stray ``on`` verbatim into its XML and wedges engine init,
    protocol.md "Matrix form lane"), the selected option per select, text/number
    values as-is. Returns ``(fields, file_input_names)`` — the daemon silently
    ignores any partial POST, so every write must carry the whole thing.
    """
    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form")
    fields: dict[str, str] = {}
    files: list[str] = []
    for el in form.find_all(["input", "select"]) if isinstance(form, Tag) else []:
        name = el.get("name")
        if not isinstance(name, str) or not name:
            continue
        if el.name == "select":
            fields[name] = _selected_value(el)
        elif el.get("type") == "file":
            files.append(name)
        else:
            value = _submitted_value(el)
            if value is not None:
                fields[name] = value
    return fields, files


def _selected_value(el: Tag) -> str:
    opts = el.find_all("option")
    sel = next((o for o in opts if o.has_attr("selected")), opts[0] if opts else None)
    return (attr(sel, "value") or "") if isinstance(sel, Tag) else ""


def _submitted_value(el: Tag) -> str | None:
    """Return what a browser submits for an input.

    None for buttons and unchecked checkboxes; a checked checkbox submits its
    value attr (never 'on').
    """
    itype = el.get("type", "text")
    if itype in ("submit", "button"):
        return None
    if itype == "checkbox":
        return (attr(el, "value") or "on") if el.has_attr("checked") else None
    return attr(el, "value") or ""


# The CRUD verbs /config/profile/{action} takes for the preset mirrors.
_ACTIONS = ("load", "save", "delete")


class UnknownProfileActionError(ValueError):
    """A staged ``/config/profile`` action is not one of ``_ACTIONS``."""

    def __init__(self, *, action: str) -> None:
        """Render the wording naming the unrecognized action."""
        super().__init__(f"unknown profile action: {action}")


class _LastParse[F]:
    """One getter's last fetched body and the form parsed from it.

    A body byte-identical to the last one returns that same parsed object, so its
    readers share it and must not mutate it; any other body is parsed afresh and
    replaces the pair.
    """

    def __init__(self, parse: Callable[[str], F]) -> None:
        """Hold ``parse``, with nothing fetched yet."""
        self._parse = parse
        self._last: tuple[bytes, F] | None = None

    def __call__(self, resp: httpx.Response) -> F:
        """Return the form for ``resp``'s body, parsing only when it differs from the last body seen."""
        body = resp.content
        if self._last is None or self._last[0] != body:
            self._last = (body, self._parse(resp.text))
        return self._last[1]


@dataclass(frozen=True)
class HttpOptions:
    """How long each 8088 request waits for HQPlayer, and what carries it.

    ``transport`` replaces httpx's own socket transport; left out, requests go over the network.
    """

    timeout: float = 10.0
    transport: httpx.AsyncBaseTransport | None = None


class HttpUnreachableError(httpx.TransportError):
    """An 8088 request that never reached HQPlayer: nothing answered at the address it was sent to.

    Subclasses ``httpx.TransportError`` so every site that catches ``httpx.HTTPError`` handles it unchanged.
    """

    def __init__(self, *, host: str, port: int, request: httpx.Request) -> None:
        """Render the wording naming the ``host`` and ``port`` that did not answer."""
        super().__init__(f"HQPlayer is not reachable at {host}:{port}.", request=request)


@contextlib.contextmanager
def hqplayer_request(host: str, port: int, timeout: float) -> Iterator[None]:
    """Report an 8088 request that timed out or never reached ``host:port`` in HQPTuner's words, not httpx's."""
    with http_deadline(timeout):
        try:
            yield
        except httpx.TimeoutException:
            raise
        except httpx.TransportError as exc:
            raise HttpUnreachableError(host=host, port=port, request=exc.request) from exc


class HttpConfigClient:
    """Async client for hqplayerd's HTTP configuration interface — the /config, /matrix, /speakers and /backup forms.

    Every route here is a read or a whole-form write against that port; nothing on this lane touches the 4321
    control protocol.
    """

    def __init__(self, host: str, port: int, username: str, password: str, options: HttpOptions | None = None):
        """Open the Digest-authenticated connection pool against ``host:port``, on ``options`` or the defaults."""
        options = options or HttpOptions()
        self._host, self._port, self._timeout = host, port, options.timeout
        self._client = httpx.AsyncClient(
            base_url=f"http://{host}:{port}",
            auth=httpx.DigestAuth(username, password),
            timeout=options.timeout,
            transport=options.transport,
        )
        #: What this client's own requests have proven about the credentials it was
        #: built with — None until the first response lands, then True or False.
        #: This field is never reset by a request that fails for a reason other
        #: than the credentials (a plain wire fault leaves whatever verdict is
        #: already here standing).
        self.credentials_ok: bool | None = None
        self._config = _LastParse(parse_config_form)
        self._matrix = _LastParse(parse_matrix_form)
        self._speakers = _LastParse(parse_speakers_form)

    def _mark(self, resp: httpx.Response) -> None:
        """Raise on any non-2xx, recording what this response proved about the credentials.

        The one place ``AuthRefused`` is caught for that purpose: a side effect on
        this client's own state, not a value — the exception propagates unchanged
        to every caller on this lane. Any other error status raises ``HttpRefusedError``
        and leaves the credential verdict as it stood.
        """
        try:
            raise_for_status(resp)
        except AuthRefused:
            self.credentials_ok = False
            raise
        self.credentials_ok = True

    async def _get(self, path: str) -> httpx.Response:
        """GET, raising on any non-2xx.

        Every read on this lane goes through here so no route can forget to check
        the status and parse an error page as if it were a form.
        """
        with hqplayer_request(self._host, self._port, self._timeout):
            resp = await self._client.get(path)
        self._mark(resp)
        return resp

    async def _post(
        self,
        path: str,
        *,
        data: dict[str, str] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> None:
        """POST, raising on any non-2xx.

        No caller needs the body — the daemon answers a write with its own HTML
        page, and what actually landed is established by readback, never by the
        response.
        """
        with hqplayer_request(self._host, self._port, self._timeout):
            resp = await self._client.post(path, data=data, files=files)
        self._mark(resp)

    async def get_config(self) -> ConfigForm:
        """GET /config — the persistent-settings form, parsed into fields plus the preset select."""
        return self._config(await self._get("/config"))

    async def get_matrix(self) -> MatrixForm:
        """GET /matrix — the pipeline/post-processing form.

        Carries pipeline rows, matrix profiles, Bauer crossfeed, DAC correction
        and loudness. The daemon silently ignores a partial POST here too, so
        writes overlay a fresh read (manager).
        """
        return self._matrix(await self._get("/matrix"))

    # No profile CRUD on this lane. save/delete are staged ``<matrix_profile>``
    # config edits and load rides 4321 ``MatrixSetProfile``. Nothing here
    # writes /matrix.

    async def get_speakers(self) -> SpeakersForm:
        """GET /speakers — the multi-channel speaker-processing form (readme §1.9).

        Carries the enabled switch and per-channel level (dBFS) + distance (cm).
        """
        return self._speakers(await self._get("/speakers"))

    async def apply_speakers(self, channels: dict[str, dict[str, str]], *, enabled: bool) -> None:
        """Apply speaker processing via the /speakers Apply form.

        Overlays the desired enabled + per-channel level/distance onto a fresh
        COMPLETE GET (a partial POST is silently ignored, same contract as
        /config and /matrix) and enforces the checkbox contract: ``enabled=1`` when on, the field
        OMITTED when off — never a raw ``0``/``on``, which the daemon writes
        verbatim and wedges engine init. Levels are validated
        to dBFS [-60, 0], distances to cm [0, 5000] — garbage is rejected, not
        sent. The daemon reloads the engine (~3 s), interrupting playback.
        """
        # generic complete-form serialize
        fields, _ = serialize_matrix_form((await self._get("/speakers")).text)
        fields.pop("enabled", None)  # checkbox rebuilt below, contract-safe
        for idx, ch in channels.items():
            i = int(idx)
            if "level" in ch:
                fields[f"level_{i}"] = _validate_speaker_num(ch["level"], _SPK_LEVEL, f"level_{i}")
            if "distance" in ch:
                fields[f"distance_{i}"] = _validate_speaker_num(ch["distance"], _SPK_DISTANCE, f"distance_{i}")
        if enabled:
            fields["enabled"] = "1"
        await self._post("/speakers", data=fields)

    async def post_profile(self, action: str, **fields: str) -> None:
        """Preset CRUD: action in load/save/delete (protocol.md §3.6).

        `load` also restarts the daemon.
        """
        if action not in _ACTIONS:
            raise UnknownProfileActionError(action=action)
        await self._post(f"/config/profile/{action}", data=fields)

    async def refresh_devices(self) -> None:
        """Ask the daemon to re-scan its output devices.

        Verified against the live
        6.0.4 web UI: the "Refresh devices" button is a submit in a ``method=get``
        form with ``formaction="/config/refresh"``, i.e. a bare ``GET
        /config/refresh`` (no body). A POST is silently ignored. Picks up an
        endpoint (e.g. a NAA that was powered off) absent from the device list —
        the caller re-reads the form afterwards to serve the new options.
        """
        await self._get("/config/refresh")

    async def restore(self, cfgfile: bytes, scope: str = "system") -> None:
        """Restore a full settings archive via multipart ``POST /restore``.

        ``scope="system"`` targets the running config (``/etc/hqplayer``);
        ``"user"`` targets ``~/.hqplayer``. ``scope=system``
        writes every archive member to disk (**additively** — a member omitted
        from the zip is not deleted) and the daemon self-restarts (~5.6 s), landing
        on the ``[default]`` config (``hqplayerd.xml``); it does **not** restore a
        named active profile (docs/spec/protocol.md §3.6). The connection manager's
        outage path handles the restart/resync. ``cfgfile`` is a ``/backup``
        settings.zip (or config xml).
        """
        await self._post(
            "/restore",
            data={"scope": scope},
            files={"cfgfile": ("settings.zip", cfgfile, "application/zip")},
        )

    async def backup(self) -> bytes:
        """Daemon's settings backup (a zip) — a safety copy taken before an apply.

        The plain /backup route is only the HTML page; the actual settings
        archive is /backup/settings.zip (verified on 6.0.4).
        """
        return (await self._get("/backup/settings.zip")).content

    async def aclose(self) -> None:
        """Close the underlying HTTP client and its connection pool."""
        await self._client.aclose()
