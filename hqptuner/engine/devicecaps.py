"""Output-device capability, learned from the daemon's own log.

Nothing on the wire reports what the selected output device can carry. The
``/config`` form offers every rate whatever device is picked, and the Control
API has no capability command — ``GetRates`` answers for the loaded chain, and
only while something is playing. What the daemon *does* do is announce, on every
endpoint connect, the device it opened followed by one line per format that
device accepts. That announcement is the only capability source there is, so the
rate menus take it from the log (the same ``GET /log`` lane the System tab tails).

Absence of evidence narrows nothing. An unreadable log, logging switched off, no
announcement, or an announcement naming a device other than the selected one all
resolve to ``None`` — and every menu stays whole, exactly as before this existed.
"""

import re
from typing import Any

# The announcement pair. The device line carries endpoint and device separately;
# joined with "/" they are the `net_device` form value verbatim, which is what
# the caller matches against.
_DEVICE_RE = re.compile(r"output endpoint '([^']*)' : '([^']*)'")
# The backend word in the middle ("NAA output network format") is optional, so
# one pattern covers however the other backends word their own announcement. The
# bits/channels fields are matched but not kept: the menus choose a rate, and a
# device announcing a rate at all is what makes that rate reachable.
_FORMAT_RE = re.compile(r"output (?:\w+ )?format: (\d+)/\d+/\d+ \[(pcm|dsd)\]")
# The form field naming the device each backend drives. Combo is deliberately
# absent: it drives both devices and the daemon announces one, so which device's
# limits bind is unknown and combo narrows nothing.
_DEVICE_FIELD = {"network": "net_device", "alsa": "alsa_device"}


def _form_values(config_form: dict[str, Any] | None) -> dict[Any, Any]:
    return {f.get("name"): f.get("value") for f in (config_form or {}).get("fields", [])}


def parse_caps(text: str) -> dict[str, Any] | None:
    """Return the most recent device announcement in ``text``, or None if it has none.

    The block is re-emitted on every connect and only for the device actually
    opened, so the last one in the log is the current one — earlier blocks are
    previous devices and are deliberately discarded rather than merged.
    """
    device: str | None = None
    formats: list[tuple[str, str]] = []
    for line in text.splitlines():
        opened = _DEVICE_RE.search(line)
        if opened:
            device, formats = f"{opened.group(1)}/{opened.group(2)}", []
        elif device is not None:
            formats.extend(_FORMAT_RE.findall(line))
    return _caps(device, formats)


def _rates(formats: list[tuple[str, str]], kind: str) -> list[int]:
    return sorted({int(rate) for rate, announced in formats if announced == kind})


def _caps(device: str | None, formats: list[tuple[str, str]]) -> dict[str, Any] | None:
    """One announcement as the served shape, or None when it announced nothing."""
    if device is None or not formats:
        return None
    return {"device": device, "pcm_rates": _rates(formats, "pcm"), "dsd_rates": _rates(formats, "dsd")}


def _device(values: dict[Any, Any]) -> str | None:
    """Return the device one view's field values name — its backend's own device field, or None."""
    field = _DEVICE_FIELD.get(str(values.get("backend") or ""))
    if field is None:
        return None
    return str(values.get(field) or "") or None


def selected_device(config_form: dict[str, Any] | None) -> str | None:
    """Return the device the menus should narrow to, from a parsed ``GET /config`` form.

    Network and ALSA backends each drive one device and narrow to it. Combo
    drives both at once, and the log announces one — which device's limits bind
    is unknown, so combo narrows nothing.
    """
    return _device(_form_values(config_form))


def agreed_device(config_form: dict[str, Any] | None, file_config: dict[str, str] | None) -> str | None:
    """Return the device both config views name, or None when they disagree.

    The ``/config`` form and the file view are refreshed on different schedules,
    so loading a preset leaves a window where they describe different devices —
    the file already carries the new preset's, the form still reports the one
    before it. A capability read in that window describes one generation's device
    beside another generation's settings, which is how a reachable rate came to
    be corrected down to a device the user had just switched away from.

    The file view speaks the same form-field names (conf/presetconf.FIELD_MAP),
    so the two are compared directly. A file view that is absent, or silent about
    the device, is not a disagreement: there is only one answer and the form
    carries it.
    """
    selected = selected_device(config_form)
    if selected is None or not file_config:
        return selected
    other = _device(dict(file_config))
    return selected if other is None or other == selected else None


def caps_for(text: str, selected: str | None) -> dict[str, Any] | None:
    """Capability for ``selected``, or None when the log cannot speak for it.

    A staged device change is exactly this case: the newly picked device has not
    been opened, so the log still names the old one and the two do not match.
    Narrowing to the old device's limits would gray rates the new one may well
    carry, so it narrows nothing until the daemon announces the new device.
    """
    if not selected:
        return None
    caps = parse_caps(text)
    return caps if caps is not None and caps["device"] == selected else None
