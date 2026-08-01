"""Pydantic request bodies for the main API surface (``app``/``pendingapi``).

Split out of ``app`` by the file-length gate. Sibling surfaces
(``livepresetapi``, ``matrixapi``) keep their own bodies.
"""

from pydantic import BaseModel


class StageBody(BaseModel):
    live: dict[str, dict[str, str]] = {}
    http: dict[str, str] = {}


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
