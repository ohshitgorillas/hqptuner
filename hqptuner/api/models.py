"""Pydantic request bodies for the main API surface (``app``/``pendingapi``).

Split out of ``app`` by the file-length gate. Sibling surfaces
(``livepresetapi``, ``matrixapi``) keep their own bodies.
"""

from pydantic import BaseModel


class DropBody(BaseModel):
    """Entries to REMOVE from the staged buffer, named rather than valued.

    The client sends these for edits that have returned to their baseline: the value is no longer a change, so it must
    not ride along on the next apply and restart the daemon for nothing. `live` names arguments within a live key;
    `http` names whole fields.
    """

    live: dict[str, list[str]] = {}
    http: list[str] = []


class StageBody(BaseModel):
    """Carry one staging request's additions and removals for ``POST /api/config/stage``.

    ``live`` and ``http`` merge into the buffer; ``drop`` is applied afterwards, so one request can both re-stage a
    field and report another clean.
    """

    live: dict[str, dict[str, str]] = {}
    http: dict[str, str] = {}
    drop: DropBody = DropBody()


class SaveTarget(BaseModel):
    """Name the preset a successful apply persists into — nested under ``ApplyBody.save``."""

    name: str


class ApplyBody(BaseModel):
    """Carry the optional preset instructions for ``POST /api/config/apply`` — both fields absent applies the buffer."""

    # optional: after a successful apply, persist the (now clean) working config
    # into this preset snapshot — the active one (Apply & Save) or a new name
    # (Save as New). Absent = ephemeral apply (working config only).
    save: SaveTarget | None = None
    # optional: the user previewed this preset in the editor; apply loads it first
    # so it becomes active, then applies the staged tweaks on top of its snapshot.
    switch_to: str | None = None


class LiveBody(BaseModel):
    """Carry the live config-form field/value pairs ``POST /api/config/live`` writes immediately."""

    fields: dict[str, str] = {}


class ProfileBody(BaseModel):
    """Carry the preset name ``POST /api/profile/{action}`` loads, saves, or deletes."""

    name: str = ""


class VolumeBody(BaseModel):
    """Carry the playback-volume level ``POST /api/volume`` writes to the live lane."""

    level: str


class EngineBody(BaseModel):
    """Carry the hardware-accel attribute overrides for ``POST /api/engine``.

    ``all_presets`` writes them into every snapshot in the backup archive instead of only the active preset's.
    """

    overrides: dict[str, str] = {}
    all_presets: bool = False


class AutosaveBody(BaseModel):
    """Carry the on/off flag ``POST /api/autosave`` sets on the preset store."""

    enabled: bool
