"""One Engine view answers every join over the running enumerations.

Every case reads one Engine reading the test writes itself: State, Status, the
enumerations from ``tests/support/fixtures/engine_view/enumerations.json`` and a
matrix profile list. The two chains number their enum IDs differently there, as
the Engine does: ``sinc-M`` is enum ID 23 at index 2 under PCM and at index 1
under SDM. Expected values are the joins and refusal causes the field register
states, and the live snapshot's rule that ``""`` is the default matrix.
"""

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

import pytest
from answered_reading import Answered

from hqptuner.engine.view import Cause, EngineView, Reading, Refusal, says
from hqptuner.fields.model import Chain, Enumeration

FIXTURE = Path(__file__).parent.parent / "support" / "fixtures" / "engine_view" / "enumerations.json"
TABLES = json.loads(FIXTURE.read_text())
MODES: Mapping[str, list[dict[str, str]]] = TABLES["modes"]
CHAINS: Mapping[str, Mapping[str, list[dict[str, str]]]] = TABLES["chains"]

PROFILES = ("Speakers", "Headphones")
UNLISTED_PROFILE = "Kitchen"

#: PCM configured and loaded: filter1x IIR, filter sinc-M, dither NS9, 96000 Hz, junk filter fast.
PCM_STATE = {
    "mode": "1",
    "filter1x": "1",
    "filterNx": "2",
    "shaper": "1",
    "rate": "4",
    "filter_junk": "2",
    "adaptive": "1",
}
PCM_STATUS = {"active_mode": "PCM", "active_rate": "96000"}

#: SDM configured and loaded: oversampling1x poly-sinc-gauss-long, oversampling sinc-M, modulator ASDM7.
SDM_STATE = {
    "mode": "2",
    "filter1x": "0",
    "filterNx": "1",
    "shaper": "1",
    "rate": "1",
    "filter_junk": "0",
    "adaptive": "0",
}
SDM_STATUS = {"active_mode": "SDM (DSD)", "active_rate": "2822400"}

#: ``[source]`` configured: the Engine echoes ``[source]`` as the active mode.
AUTO_STATE = {**PCM_STATE, "mode": "0"}


def enumerations(chain: str, modes: str = "stock") -> dict[str, list[dict[str, str]]]:
    """Return the fixture's lists for ``chain`` with the modes list named ``modes``."""
    return {Enumeration.MODES: MODES[modes], **CHAINS[chain]}


def view_of(
    state: Mapping[str, str],
    status: Mapping[str, str] | None,
    chain: str,
    modes: str = "stock",
    profiles: Sequence[str] | None = PROFILES,
) -> EngineView:
    """Return the view of one reading built from the fixture tables."""
    return EngineView.of(Answered(state, status, enumerations(chain, modes), profiles))


def pcm() -> EngineView:
    """Return the view of an Engine running PCM."""
    return view_of(PCM_STATE, PCM_STATUS, "pcm")


def sdm() -> EngineView:
    """Return the view of an Engine running SDM."""
    return view_of(SDM_STATE, SDM_STATUS, "sdm")


def auto(active_mode: str, active_rate: str) -> EngineView:
    """Return the view of an Engine in ``[source]`` whose Status reports the given mode and rate."""
    return view_of(AUTO_STATE, {"active_mode": active_mode, "active_rate": active_rate}, "pcm")


def reordered(mode: str) -> EngineView:
    """Return the view of an Engine whose modes list runs SDM, ``[source]``, PCM, at State mode ``mode``."""
    return view_of({**PCM_STATE, "mode": mode}, PCM_STATUS, "pcm", modes="reordered")


def variant(mode: str) -> EngineView:
    """Return the view of an Engine whose mode names differ in case and prefix, at State mode ``mode``."""
    return view_of({**PCM_STATE, "mode": mode}, PCM_STATUS, "pcm", modes="variant")


def pcm_only() -> EngineView:
    """Return the view of an Engine on a device whose modes list carries no SDM item."""
    return view_of(PCM_STATE, PCM_STATUS, "pcm", modes="pcm_only")


View = Callable[[], EngineView]


# --- Joins 2 and 6: mode by name, and the configured chain --------------------


@pytest.mark.parametrize(
    ("build", "form_value"),
    [
        pytest.param(lambda: auto("[source]", "96000"), "auto", id="stock-source"),
        pytest.param(pcm, "pcm", id="stock-pcm"),
        pytest.param(sdm, "sdm", id="stock-sdm"),
        pytest.param(lambda: reordered("0"), "sdm", id="reordered-index0-sdm"),
        pytest.param(lambda: reordered("2"), "pcm", id="reordered-index2-pcm"),
        pytest.param(lambda: variant("0"), "auto", id="case-ignored-source"),
        pytest.param(lambda: variant("1"), "pcm", id="case-ignored-pcm"),
        pytest.param(lambda: variant("2"), "sdm", id="dsd-prefix-sdm"),
    ],
)
def test_the_running_mode_is_the_form_value_its_items_name_denotes(build: View, form_value: str) -> None:
    assert build().mode() == form_value


@pytest.mark.parametrize(
    ("build", "chain"),
    [
        pytest.param(pcm, Chain.PCM, id="stock-pcm"),
        pytest.param(sdm, Chain.SDM, id="stock-sdm"),
        pytest.param(lambda: reordered("0"), Chain.SDM, id="reordered-index0-sdm"),
        pytest.param(lambda: reordered("2"), Chain.PCM, id="reordered-index2-pcm"),
        pytest.param(lambda: variant("2"), Chain.SDM, id="dsd-prefix-sdm"),
    ],
)
def test_the_configured_chain_is_the_chain_the_mode_items_name_denotes(build: View, chain: Chain) -> None:
    assert build().configured_chain() == chain


def test_source_configures_no_chain_where_pcm_configures_one_under_the_same_status() -> None:
    assert auto("PCM", "96000").configured_chain() != pcm().configured_chain()


# --- Join 7: the loaded chain -------------------------------------------------


def test_a_configured_chain_is_the_loaded_chain_whatever_status_reports() -> None:
    disagreeing = view_of(PCM_STATE, {"active_mode": "SDM (DSD)", "active_rate": "2822400"}, "pcm")
    assert disagreeing.loaded_chain() == Chain.PCM


@pytest.mark.parametrize(
    ("active_rate", "chain"),
    [
        pytest.param("2822400", Chain.SDM, id="lowest-sdm-rate"),
        pytest.param("5644800", Chain.SDM, id="higher-sdm-rate"),
        pytest.param("2822399", Chain.PCM, id="just-below-sdm"),
        pytest.param("1411200", Chain.PCM, id="high-pcm-rate"),
        pytest.param("44100", Chain.PCM, id="low-pcm-rate"),
    ],
)
def test_in_source_the_loaded_chain_is_the_family_of_the_active_rate(active_rate: str, chain: Chain) -> None:
    assert auto("[source]", active_rate).loaded_chain() == chain


@pytest.mark.parametrize(
    ("active_mode", "active_rate", "chain"),
    [
        pytest.param("SDM (DSD)", "705600", Chain.SDM, id="sdm-named-over-pcm-rate"),
        pytest.param("PCM", "2822400", Chain.PCM, id="pcm-named-over-sdm-rate"),
    ],
)
def test_in_source_a_chain_status_names_is_the_loaded_chain_over_the_rate_family(
    active_mode: str, active_rate: str, chain: Chain
) -> None:
    assert auto(active_mode, active_rate).loaded_chain() == chain


@pytest.mark.parametrize(
    "status",
    [
        pytest.param({"active_mode": "[source]", "active_rate": "0"}, id="rate-zero"),
        pytest.param({"active_mode": "[source]"}, id="rate-absent"),
        pytest.param(None, id="status-unread"),
    ],
)
def test_in_source_with_no_active_rate_a_chain_field_is_off_the_chain(status: Mapping[str, str] | None) -> None:
    outcome = view_of(AUTO_STATE, status, "pcm").resolve("filter", "23")
    assert isinstance(outcome, Refusal)
    assert outcome.cause == Cause.OFF_CHAIN


# --- Joins 1 to 4: form value to list index -----------------------------------


@pytest.mark.parametrize(
    ("build", "field", "value", "index"),
    [
        pytest.param(pcm, "filter", "23", "2", id="pcm-filter-enum-id"),
        pytest.param(pcm, "filter1x", "4", "1", id="pcm-filter1x-enum-id"),
        pytest.param(pcm, "dither", "12", "2", id="pcm-dither-enum-id"),
        pytest.param(sdm, "oversampling", "23", "1", id="sdm-oversampling-enum-id"),
        pytest.param(sdm, "oversampling1x", "38", "0", id="sdm-oversampling1x-enum-id"),
        pytest.param(sdm, "modulator", "9", "1", id="sdm-modulator-enum-id"),
        pytest.param(pcm, "mode", "sdm", "2", id="stock-mode-by-name"),
        pytest.param(lambda: reordered("2"), "mode", "pcm", "2", id="reordered-pcm-by-name"),
        pytest.param(lambda: reordered("2"), "mode", "auto", "1", id="reordered-auto-by-name"),
        pytest.param(pcm, "rate", "96000", "4", id="pcm-rate-by-hz"),
        pytest.param(sdm, "rate", "5644800", "2", id="sdm-rate-by-hz"),
        pytest.param(pcm, "junk_filter", "1", "1", id="junk-filter-listed-index"),
    ],
)
def test_a_form_value_joins_to_the_index_of_the_item_carrying_it(
    build: View, field: str, value: str, index: str
) -> None:
    assert build().index_of(field, value) == index


@pytest.mark.parametrize(
    ("build", "loaded_field", "unloaded_field", "value"),
    [
        pytest.param(pcm, "filter", "oversampling", "23", id="pcm-loaded"),
        pytest.param(sdm, "oversampling", "filter", "23", id="sdm-loaded"),
    ],
)
def test_an_enum_id_joins_only_for_the_field_of_the_loaded_chain(
    build: View, loaded_field: str, unloaded_field: str, value: str
) -> None:
    view = build()
    assert view.index_of(unloaded_field, value) != view.index_of(loaded_field, value)


@pytest.mark.parametrize(
    ("build", "field", "index", "value"),
    [
        pytest.param(pcm, "filter", "2", "23", id="pcm-filter"),
        pytest.param(sdm, "oversampling", "2", "6", id="sdm-oversampling"),
        pytest.param(pcm, "dither", "1", "5", id="pcm-dither"),
        pytest.param(pcm, "rate", "3", "88200", id="pcm-rate"),
        pytest.param(pcm, "mode", "2", "sdm", id="stock-mode"),
        pytest.param(lambda: reordered("2"), "mode", "0", "sdm", id="reordered-mode"),
        pytest.param(pcm, "junk_filter", "2", "2", id="junk-filter"),
    ],
)
def test_a_list_index_joins_to_the_form_value_of_the_item_at_it(
    build: View, field: str, index: str, value: str
) -> None:
    assert build().value_at(field, index) == value


@pytest.mark.parametrize(
    ("build", "enumeration", "index", "name"),
    [
        pytest.param(pcm, Enumeration.FILTERS, "3", "poly-sinc-gauss-long", id="pcm-filter"),
        pytest.param(sdm, Enumeration.FILTERS, "0", "poly-sinc-gauss-long", id="sdm-filter"),
        pytest.param(sdm, Enumeration.SHAPERS, "0", "DSD5", id="sdm-shaper"),
        pytest.param(pcm, Enumeration.JUNK_FILTERS, "1", "slow", id="junk-filter"),
        pytest.param(lambda: reordered("2"), Enumeration.MODES, "0", "SDM (DSD)", id="reordered-mode"),
    ],
)
def test_an_index_names_the_item_at_it(build: View, enumeration: Enumeration, index: str, name: str) -> None:
    assert build().name_at(enumeration, index) == name


@pytest.mark.parametrize(
    ("build", "enumeration", "name", "index"),
    [
        pytest.param(pcm, Enumeration.JUNK_FILTERS, "fast", "2", id="junk-filter-by-name"),
        pytest.param(pcm, Enumeration.FILTERS, "sinc-M", "2", id="pcm-filter-by-name"),
        pytest.param(sdm, Enumeration.FILTERS, "sinc-M", "1", id="sdm-filter-by-name"),
    ],
)
def test_a_name_joins_to_the_index_of_the_item_carrying_it(
    build: View, enumeration: Enumeration, name: str, index: str
) -> None:
    assert build().index_named(enumeration, name) == index


# --- Joins 5 and 8: a reading is a value and a name, on its chain only ---------


@pytest.mark.parametrize(
    ("build", "field", "reading"),
    [
        pytest.param(pcm, "filter", Reading("23", "sinc-M"), id="pcm-filter"),
        pytest.param(pcm, "filter1x", Reading("4", "IIR"), id="pcm-filter1x"),
        pytest.param(pcm, "dither", Reading("5", "NS9"), id="pcm-dither"),
        pytest.param(sdm, "oversampling", Reading("23", "sinc-M"), id="sdm-oversampling"),
        pytest.param(sdm, "oversampling1x", Reading("38", "poly-sinc-gauss-long"), id="sdm-oversampling1x"),
        pytest.param(sdm, "modulator", Reading("9", "ASDM7"), id="sdm-modulator"),
        pytest.param(pcm, "mode", Reading("pcm", "PCM"), id="pcm-mode"),
        pytest.param(sdm, "mode", Reading("sdm", "SDM (DSD)"), id="sdm-mode"),
        pytest.param(lambda: auto("[source]", "96000"), "mode", Reading("auto", "[source]"), id="source-mode"),
        pytest.param(pcm, "junk_filter", Reading("2", "fast"), id="junk-filter"),
        pytest.param(pcm, "rate", Reading("96000", "96000"), id="rate-names-itself"),
        pytest.param(pcm, "adaptive_volume", Reading("1", "1"), id="flag-names-itself-on"),
        pytest.param(sdm, "adaptive_volume", Reading("0", "0"), id="flag-names-itself-off"),
        pytest.param(lambda: auto("[source]", "96000"), "filter", Reading("23", "sinc-M"), id="source-on-pcm"),
    ],
)
def test_a_field_reads_as_its_form_value_and_the_name_its_item_carries(
    build: View, field: str, reading: Reading
) -> None:
    assert build().read(field) == reading


@pytest.mark.parametrize(
    ("build", "loaded_field", "unloaded_field"),
    [
        pytest.param(pcm, "filter", "oversampling", id="pcm-loaded-filter"),
        pytest.param(pcm, "dither", "modulator", id="pcm-loaded-shaper"),
        pytest.param(sdm, "oversampling1x", "filter1x", id="sdm-loaded-filter1x"),
        pytest.param(lambda: auto("[source]", "2822400"), "modulator", "dither", id="source-on-sdm-shaper"),
    ],
)
def test_a_field_of_the_chain_not_loaded_reads_nothing_where_its_twin_reads(
    build: View, loaded_field: str, unloaded_field: str
) -> None:
    view = build()
    assert view.read(unloaded_field) != view.read(loaded_field)


# --- Rules 5 and 7: the live index, or the one cause it cannot be written -----


@pytest.mark.parametrize(
    ("build", "field", "value", "index"),
    [
        pytest.param(pcm, "filter", "23", "2", id="pcm-filter"),
        pytest.param(sdm, "oversampling", "23", "1", id="sdm-oversampling"),
        pytest.param(sdm, "modulator", "7", "0", id="sdm-modulator"),
        pytest.param(pcm, "rate", "48000", "2", id="rate"),
        pytest.param(pcm, "junk_filter", "2", "2", id="junk-filter"),
        pytest.param(pcm, "mode", "sdm", "2", id="mode"),
        pytest.param(lambda: reordered("2"), "mode", "auto", "1", id="reordered-mode"),
        pytest.param(pcm, "adaptive_volume", "0", "0", id="flag-off"),
        pytest.param(pcm, "adaptive_volume", "1", "1", id="flag-on"),
    ],
)
def test_a_listed_value_resolves_to_its_live_index(build: View, field: str, value: str, index: str) -> None:
    assert build().resolve(field, value) == index


@pytest.mark.parametrize("value", ["01", "1.5", "true", "", " 1", "2"])
def test_a_flag_value_other_than_the_strings_0_and_1_is_refused_as_not_a_flag(value: str) -> None:
    outcome = pcm().resolve("adaptive_volume", value)
    assert isinstance(outcome, Refusal)
    assert outcome.cause == Cause.NOT_FLAG


#: Values the running list does not carry, each with the enumeration that refuses it.
UNLISTED: list[tuple[View, str, str, Enumeration, str]] = [
    (pcm, "filter", "99", Enumeration.FILTERS, "pcm-filter-id"),
    (pcm, "filter1x", "38", Enumeration.FILTERS, "pcm-filter1x-sdm-only-id"),
    (sdm, "modulator", "5", Enumeration.SHAPERS, "sdm-modulator-pcm-only-id"),
    (pcm, "rate", "12288000", Enumeration.RATES, "pcm-rate-hz"),
    (pcm, "junk_filter", "7", Enumeration.JUNK_FILTERS, "junk-filter-index"),
    (pcm_only, "mode", "sdm", Enumeration.MODES, "mode-the-device-lacks"),
]


@pytest.mark.parametrize(("build", "field", "value"), [pytest.param(b, f, v, id=i) for b, f, v, _, i in UNLISTED])
def test_a_value_the_running_list_does_not_carry_is_refused_as_not_listed(build: View, field: str, value: str) -> None:
    outcome = build().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert outcome.cause == Cause.NOT_LISTED


@pytest.mark.parametrize(
    ("build", "field", "value", "enumeration"), [pytest.param(b, f, v, e, id=i) for b, f, v, e, i in UNLISTED]
)
def test_a_not_listed_refusal_names_the_enumeration_that_lacks_the_value(
    build: View, field: str, value: str, enumeration: Enumeration
) -> None:
    outcome = build().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert outcome.enumeration == enumeration


#: Values of the chain not loaded, each with that chain. A chain-blind join would
#: resolve ``23`` on either chain and refuse ``38``, ``9``, ``4`` and ``5`` as unlisted.
OFF_CHAIN: list[tuple[View, str, str, Chain, str]] = [
    (pcm, "oversampling", "23", Chain.SDM, "pcm-loaded-oversampling"),
    (pcm, "oversampling1x", "38", Chain.SDM, "pcm-loaded-oversampling1x"),
    (pcm, "modulator", "9", Chain.SDM, "pcm-loaded-modulator"),
    (sdm, "filter", "23", Chain.PCM, "sdm-loaded-filter"),
    (sdm, "filter1x", "4", Chain.PCM, "sdm-loaded-filter1x"),
    (sdm, "dither", "5", Chain.PCM, "sdm-loaded-dither"),
]


@pytest.mark.parametrize(("build", "field", "value"), [pytest.param(b, f, v, id=i) for b, f, v, _, i in OFF_CHAIN])
def test_a_value_of_the_chain_not_loaded_is_refused_as_off_the_chain(build: View, field: str, value: str) -> None:
    outcome = build().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert outcome.cause == Cause.OFF_CHAIN


@pytest.mark.parametrize(
    ("build", "field", "value", "chain"), [pytest.param(b, f, v, c, id=i) for b, f, v, c, i in OFF_CHAIN]
)
def test_an_off_chain_refusal_names_the_chain_the_field_belongs_to(
    build: View, field: str, value: str, chain: Chain
) -> None:
    outcome = build().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert outcome.chain == chain


@pytest.mark.parametrize(
    ("field", "value"),
    [
        pytest.param("title", "Living room", id="file-only-field"),
        pytest.param("defaults_samplerate", "96000", id="pcm-rate-limit"),
        pytest.param("defaults_bitrate", "2822400", id="sdm-rate-limit"),
    ],
)
def test_a_field_with_no_live_setter_is_refused_as_not_live(field: str, value: str) -> None:
    outcome = pcm().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert outcome.cause == Cause.NOT_LIVE


def test_a_matrix_profile_the_engine_does_not_list_is_refused_as_unlisted() -> None:
    outcome = pcm().resolve("matrix_profile", UNLISTED_PROFILE)
    assert isinstance(outcome, Refusal)
    assert outcome.cause == Cause.PROFILE_UNLISTED


# --- the one wording of a refusal carries what was refused --------------------
# The sentences are owner copy; only the values the fixture put in are pinned.

#: One refusal of every cause whose wording states the value, each with the value refused.
REFUSED: list[tuple[View, str, str, str]] = [
    (pcm, "adaptive_volume", "1.5", "not-a-flag"),
    *((b, f, v, i) for b, f, v, _, i in UNLISTED),
    (pcm, "matrix_profile", UNLISTED_PROFILE, "profile-unlisted"),
]


@pytest.mark.parametrize(("build", "field", "value"), [pytest.param(b, f, v, id=i) for b, f, v, i in REFUSED])
def test_a_refusal_wording_carries_the_refused_value(build: View, field: str, value: str) -> None:
    outcome = build().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert value in says(outcome)


@pytest.mark.parametrize(
    ("build", "field", "value", "enumeration"), [pytest.param(b, f, v, e, id=i) for b, f, v, e, i in UNLISTED]
)
def test_a_not_listed_wording_carries_the_enumeration_that_lacks_the_value(
    build: View, field: str, value: str, enumeration: Enumeration
) -> None:
    outcome = build().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert enumeration.value in says(outcome)


@pytest.mark.parametrize(
    ("build", "field", "value", "chain"), [pytest.param(b, f, v, c, id=i) for b, f, v, c, i in OFF_CHAIN]
)
def test_an_off_chain_wording_carries_the_chain_the_field_belongs_to(
    build: View, field: str, value: str, chain: Chain
) -> None:
    outcome = build().resolve(field, value)
    assert isinstance(outcome, Refusal)
    assert chain.value in says(outcome).lower()


# --- the matrix profile list: ``""`` is the default matrix --------------------


def test_a_listed_matrix_profile_is_listed_where_an_unlisted_one_is_not() -> None:
    view = pcm()
    assert view.profile_listed(PROFILES[1]) != view.profile_listed(UNLISTED_PROFILE)


@pytest.mark.parametrize(
    "profiles",
    [
        pytest.param(PROFILES, id="profiles-listed"),
        pytest.param((), id="none-listed"),
        pytest.param(None, id="list-unread"),
    ],
)
def test_the_default_matrix_is_always_listed(profiles: Sequence[str] | None) -> None:
    assert view_of(PCM_STATE, PCM_STATUS, "pcm", profiles=profiles).profile_listed("")
