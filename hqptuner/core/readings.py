"""What the daemon last told us — the snapshot every API read and write lane serves from.

Reads never touch the socket, so every route serves from here. Every fresh connection
refills the whole object from scratch: GetInfo, State, Status, enumerations, GET /config —
no cached pre-outage state. Persistent config can change without an HQPTuner apply (an
external preset load, the output DAC changing, HQPlayer's own web UI), so the /config and
/matrix snapshots are refetched every poll, not only on reconnect.
"""

from dataclasses import dataclass, field
from typing import Any

from hqptuner.lanes.live import lane


@dataclass
class Readings:
    """The daemon's last answers, plus the LIVE set the engine cannot hold on to by itself."""

    info: dict[str, str] | None = None
    # installed release string off the 8088 /about page (engine/release.py);
    # "" until read, and stays "" when the page is unreachable or unparseable.
    release: str = ""
    license: dict[str, str] | None = None
    state: dict[str, str] | None = None
    status: dict[str, str] | None = None
    status_metadata: dict[str, str] | None = None
    volume_range: dict[str, str] | None = None
    engine: dict[str, str] | None = None
    active_config: str | None = None
    enums: dict[str, list[dict[str, str]]] | None = None
    # What LIVE set that the engine cannot hold on to by itself — the dormant
    # family's rate pin and the dormant chain's filters (`lanes/live/lane`).
    live: lane.LiveMemory = field(default_factory=lane.LiveMemory)
    config_form: dict[str, Any] | None = None
    config_error: str | None = None
    matrix_form: dict[str, Any] | None = None
    matrix_error: str | None = None
    # Speaker processing form (readme §1.9), a top-level config element absent
    # from /config — polled over the 8088 lane like /matrix, best-effort.
    speakers_form: dict[str, Any] | None = None
    speakers_error: str | None = None
    # Saved matrix profile names from the live 4321 lane (MatrixListProfiles —
    # unauthenticated, no reload). The active one is State.matrix_profile.
    matrix_profiles: list[str] | None = None
    loaded_at: float | None = None
    # Running config read from the config FILE (the /backup archive's working
    # hqplayerd.xml), in form-field terms. The /config form is lossy for
    # settings whose XML domain is wider than the widget the daemon renders —
    # volume_fixed is 0/1/2 in the XML but a plain checkbox on the form, so the
    # form cannot distinguish -3 dB from -6 dB. Fields flagged `fileTruth` in
    # the frontend schema read their baseline from here instead. Refreshed on
    # connect and after every persistent apply (never per-poll: /backup is ~5 MB).
    file_config: dict[str, str] | None = None
    # What the selected output device announced it can carry (engine/devicecaps).
    # None means nothing is known about it and no menu narrows. Refreshed on
    # connect and whenever the selected device changes (never per-poll: GET
    # /log pulls the whole log, and the announcement only moves on a connect).
    device_caps: dict[str, Any] | None = None
    # Which device the last capability read was for, and when it ran.
    caps_device: str | None = None
    caps_at: float = 0.0
