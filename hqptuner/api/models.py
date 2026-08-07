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
    live: dict[str, dict[str, str]] = {}
    http: dict[str, str] = {}
    drop: DropBody = DropBody()


class SaveTarget(BaseModel):
    name: str


class ApplyBody(BaseModel):
    # optional: after a successful apply, persist the (now clean) working config
    # into this preset snapshot — the active one (Apply & Save) or a new name
    # (Save as New). Absent = ephemeral apply (working config only).
    save: SaveTarget | None = None
    # optional: the user previewed this preset in the editor; apply loads it first
    # so it becomes active, then applies the staged tweaks on top of its snapshot.
    switch_to: str | None = None


class LiveBody(BaseModel):
    fields: dict[str, str] = {}


class ProfileBody(BaseModel):
    name: str = ""


class VolumeBody(BaseModel):
    level: str


class EngineBody(BaseModel):
    overrides: dict[str, str] = {}
    all_presets: bool = False


class AutosaveBody(BaseModel):
    enabled: bool
