// Shared harness for the components/Field.js suites — field.test.js (binding,
// classes, values, constraints, option sources, graying, unit/hint/rescan) and
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

import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Field } from "../../../hqptuner/static/components/Field.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { staticWire } from "./wire.js";

// --- the wire ---------------------------------------------------------------
// Real REST paths, real response shapes (hqptuner/static/lib/api.js).

function wire(staged = { live: {}, http: {} }) {
  staticWire(staged);
}

// --- static metadata --------------------------------------------------------
// The /api/metadata payload shape: settings.json prose keyed by group, plus the
// filters.json / shapers.json name-keyed overlays.

const META = {
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
    filters: { "sinc-M": { description: "A very long sinc." }, "xtr-mp": { description: "Extra transient." } },
    aliases: { "poly-sinc-xtr-mp": "xtr-mp" },
    two_stage_note: "Two stage oversampling.",
  },
  shapers: {
    pcm_dithers: { TPDF: { description: "Triangular dither." }, NS9: { min_rate_hz: 352800 } },
    sdm_modulators: { ASDM7: { description: "Seventh order modulator." } },
  },
};

// --- reset ------------------------------------------------------------------

export async function reset({ fields = [], matrix = [], meta = META, desc = true, keep = true } = {}) {
  wire();
  engineState.value = {};
  enums.value = null;
  metadata.value = meta;
  config.value = { fields, file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: matrix };
  showDescriptions.value = desc;
  keepOptionDescriptions.value = keep;
  resetNarrowing();
  await discardAll();
}

// Stage one http-lane edit against a wire that echoes it back, exactly as the
// server's pending buffer would.
export async function stageEdit(key, value, http) {
  wire({ live: {}, http });
  await edit(key, value);
}

// --- rendering --------------------------------------------------------------
// SSR escapes entities; the contract is the text a user reads, not its encoding.

export const field = (k) =>
  render(html`<${Field} k=${k} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const rootAttrs = (out) => out.slice(0, out.indexOf(">"));
const classOf = (out) => (/class="([^"]*)"/.exec(rootAttrs(out)) || [])[1] || "";
export const titleOf = (out) => (/title="([^"]*)"/.exec(rootAttrs(out)) || [])[1];
export const hasClass = (out, c) => classOf(out).split(/\s+/).includes(c);

// Text of one of the field's three prose lines (note / desc / gray reason).
export function line(out, cls) {
  const m = new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`).exec(out);
  return m ? m[1] : null;
}

// Inner HTML of the field's control row — the <div class="control">…</div>
// fragment — with nested <div>s honoured. Null when there is no control row.
export function controlRow(out) {
  const open = /<div class="[^"]*\bcontrol\b[^"]*"[^>]*>/.exec(out);
  if (!open) return null;
  const start = open.index + open[0].length;
  const tags = /<(\/?)div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = tags.exec(out)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return out.slice(start, m.index);
  }
  return null;
}

// Text of the gray-reason element in a fragment, whatever tag carries the class.
export function grayReason(fragment) {
  const re = /<(\w+)[^>]*\bclass="[^"]*\bfield-gray-reason\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/;
  const m = re.exec(fragment || "");
  return m ? m[2] : null;
}

export const span = (out, cls) => {
  const m = new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>`).exec(out);
  return m ? m[1] : null;
};

export const attrOf = (fragment, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(fragment || "") || [])[1];

const opts = (out) => [...out.matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((m) => ({ a: m[1], label: m[2] }));
export const optionLabels = (out) => opts(out).map((o) => o.label);
export const optionByLabel = (out, label) => opts(out).find((o) => o.label.startsWith(label));

export const activeSegment = (out) => {
  const m = /<button[^>]*class="seg active"[^>]*>([\s\S]*?)<\/button>/.exec(out);
  return m ? m[1].trim() : null;
};

export const isDisabled = (out) => /<(?:input|select)[^>]*\bdisabled\b/.test(out);
