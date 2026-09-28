"""The document shapes the hqplayerd form parsers hand back.

Each is a JSON document by nature — a parsed hqplayerd form page — so it is
typed as a ``TypedDict`` rather than a dataclass.
"""

from typing import TypedDict

#: A form control's value as the form parser reads it: a checkbox's ``bool``, a
#: number input's ``_number`` result, a text input's or select's string, or the
#: ``None`` an absent input or an optionless select carries.
FormValue = bool | int | float | str | None


class SelectOption(TypedDict):
    """One ``<option>`` of a parsed ``<select>``."""

    value: str
    label: str
    selected: bool


class FormField(TypedDict, total=False):
    """One control off a settings form. Keys past name/type/section/label vary by input type."""

    name: str | None
    type: str
    section: str | None
    label: str | None
    value: FormValue
    min: int | float | str | None
    max: int | float | str | None
    step: int | float | str | None
    options: list[SelectOption]


class ProfileSelect(TypedDict):
    """The preset-profile select, always complete (name, value, options)."""

    name: str | None
    type: str
    section: str | None
    label: str | None
    value: str | None
    options: list[SelectOption]


class ConfigForm(TypedDict):
    """``parse_config_form``'s result."""

    fields: list[FormField]
    profiles: ProfileSelect | None


#: One /matrix pipeline-table row: ``index`` plus whichever of ``source``/``gain``/
#: ``gainunit``/``mixdown``/``process`` the form has a column for. A map keyed by
#: column name, not a fixed-shape record — a row is exactly the columns present.
MatrixRow = dict[str, FormValue]


class MatrixForm(TypedDict):
    """``parse_matrix_form``'s result."""

    fields: list[FormField]
    rows: list[MatrixRow]
    profiles: ProfileSelect | None
    active: str


#: One /speakers channel: ``index``/``label`` plus whichever of ``level``/``distance``
#: and their ``_min``/``_max``/``_step`` constraints the form supplies. A map keyed by
#: column name, not a fixed-shape record.
SpeakerChannel = dict[str, FormValue]


class SpeakersForm(TypedDict):
    """``parse_speakers_form``'s result."""

    enabled: bool
    channels: list[SpeakerChannel]
