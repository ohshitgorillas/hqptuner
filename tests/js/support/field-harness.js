// Shared harness for the components/widgets/Field.js suites — field.test.js (binding,
// classes, values, constraints, option sources, graying, unit/rescan) and
// fielddesc.test.js (hover titles, inline notes, per-selection descriptions).
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// Rendering goes through preact-render-to-string against the VENDORED preact
// bundle (tests/js/vendor-resolve.js maps the importmap specifiers), so the
// suites exercise the code that ships rather than an npm substitute.
//
// State is driven through the store's exported source signals plus a faked wire
// for the staging round-trip (docs/testing.md rule 4 — no store function is ever
// stubbed). `reset()` reassigns EVERY signal Field reads on every call rather
// than only the ones a case cares about: module-level signals persist for the
// life of the process, so a partial reset makes tests pass alone and fail in
// sequence. `staged` is not exported, so it is cleared via discardAll().

import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions, plainNames } from "../../../hqptuner/static/store/ui/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { staticWire } from "./wire/wire.js";

// --- the wire ---------------------------------------------------------------
// Real REST paths, real response shapes (hqptuner/static/lib/api.js).

/** @typedef {import("./wire/wire.js").StagedBuffer} StagedBuffer */

/**
 * One entry of a /api/config or /api/matrix field list: the name and value
 * every entry carries, plus the form metadata a /config field brings with it —
 * `options`, `min`, `max` and the rest, which the index signature admits.
 *
 * @typedef {{ [key: string]: unknown, name: string, value: unknown }} ConfigField
 */

/** @param {StagedBuffer} [staged] */
function wire(staged = { live: {}, http: {} }) {
  staticWire(staged);
}

// --- static metadata --------------------------------------------------------
// The /api/metadata payload shape: settings.json prose keyed by group, plus the
// filters.json / shapers.json name-keyed overlays.

export const META = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Mode prose." },
      pcm_rate: { label: "PCM", tooltip: "Rate prose." },
      buffer_time: { label: "Buffer time", tooltip: "Buffer prose." },
      output_device: { label: "Output Device", tooltip: "Device prose." },
    },
    volume: {
      volume_max: { label: "Max volume", tooltip: "Max prose." },
    },
    dsp: {
      sdm_integrator: {
        label: "Integrator",
        tooltip: "Integrator prose.",
        options: { 0: "Fast integrator.", 1: "Slow integrator." },
      },
      filter_1x: { label: "1x filter", tooltip: "Filter prose." },
      shaper: { label: "Shaper", tooltip: "Shaper prose." },
    },
  },
  filters: {
    filters: {
      "sinc-M": { description: "A very long sinc." },
      "xtr-mp": { description: "Extra transient." },
      // The manual's caveat sentences ride alongside the description as
      // `notes` (hqptuner/data/filters.json); three shapes of overlay record
      // carry one: description + notes, empty description + notes, and notes
      // with no description key at all.
      "sinc-S": { description: "A short sinc.", notes: "Not recommended." },
      "sinc-V": { description: "", notes: "Only note." },
      "sinc-W": { notes: "Bare note." },
      // Entries whose oversampling runs in two stages when the output is SDM
      // carry the optional `sdm_two_stage` boolean (hqptuner/data/filters.json).
      // Two shapes of flagged record: description alone, and description +
      // notes — the latter also reachable through a `-2s` label, which is how
      // the SDM-chain sentence and the `-2s` variant sentence land on one
      // string.
      // The flag is optional AND tri-state in practice: absent, true, or an
      // explicit false, which reads the same as absent. `sdm-D` is the one
      // combination where the SDM-chain join could contribute a separator to a
      // description that is not there.
      "sdm-A": { description: "A flagged sinc.", sdm_two_stage: true },
      "sdm-B": { description: "A flagged short sinc.", notes: "Flagged caveat.", sdm_two_stage: true },
      "sdm-C": { description: "An explicitly single stage sinc.", sdm_two_stage: false },
      "sdm-D": { description: "", sdm_two_stage: true },
    },
    aliases: { "poly-sinc-xtr-mp": "xtr-mp" },
    two_stage_note: "Two stage oversampling.",
    sdm_two_stage_note: "Two stage for SDM.",
  },
  shapers: {
    pcm_dithers: {
      TPDF: { description: "Triangular dither." },
      // The SDM two-stage flag is a filters.json key; a shaper record carrying
      // one is not a filter and the note it keys is not the dither's to show.
      TPDFX: { description: "Flagged dither.", sdm_two_stage: true },
      NS9: { min_rate_hz: 352800 },
      NS1: { description: "First noise shaper.", notes: "Produces ultrasonic noise." },
    },
    sdm_modulators: {
      ASDM7: { description: "Seventh order modulator." },
      ASDM9X: { description: "Flagged modulator.", sdm_two_stage: true },
      // A modulator the constraint file gives a rate FLOOR: below it the engine
      // produces no output at all, so the option row grays. The value sits
      // between the DSD512 and DSD1024 tiers, as the file's own floors do — the
      // manual states MHz thresholds rather than tiers.
      ASDM7EC: { min_rate_hz: 40960000 },
      // A second floor, so the reason a grayed row carries can be shown to name
      // the floor it was given rather than one constant. 6144000 is the DSD128
      // tier.
      ASDM5: { min_rate_hz: 6144000 },
      AHM5EC5L: { description: "Fifth order AHM.", notes: "Limited SNR." },
    },
  },
};

// --- reset ------------------------------------------------------------------

// The matrix defaults to ENGAGED. A post-process field under a bypassed matrix is
// grayed for that reason alone (store/schema.js matrixBypassed), which is a
// different behavior from the ones these suites pin — a case that wants the
// bypass passes its own `matrix`.
const MATRIX_ENGAGED = [{ name: "enabled", value: "1" }];

/**
 * @param {{
 *   fields?: ConfigField[],
 *   matrix?: ConfigField[],
 *   meta?: import("../../../hqptuner/static/store/prose.js").Metadata,
 *   desc?: boolean,
 *   keep?: boolean,
 *   plain?: boolean,
 * }} [fixture]  `plain` is the option style, Simplified when true; a case whose result depends on it passes it
 * @returns {Promise<void>}
 */
export async function reset({
  fields = [],
  matrix = MATRIX_ENGAGED,
  meta = META,
  desc = true,
  keep = true,
  plain = false,
} = {}) {
  wire();
  engineState.value = {};
  enums.value = null;
  metadata.value = meta;
  config.value = { fields, file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: matrix };
  showDescriptions.value = desc;
  keepOptionDescriptions.value = keep;
  plainNames.value = plain;
  resetNarrowing();
  await discardAll();
}

// --- rendering --------------------------------------------------------------
// SSR escapes entities; the contract is the text a user reads, not its encoding.
