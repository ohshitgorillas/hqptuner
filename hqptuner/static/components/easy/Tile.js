// One preset, as a tile. Not a `Card` and deliberately not card markup: a card
// is a section of the page, and eight of these sit INSIDE one card
// (docs/design-system.md, one card component). A rounded box on the card
// surface is what it is, so that is what it paints.
//
// A tile holds no state at all. Which tile is lit and where each knob stands are
// read off the current filter values every render (store/easy.js matchPreset),
// so there is nothing here to fall out of step with the fields a user can also
// edit by hand in the chain cards.
//
// Clicking is an ordinary field edit, four of them at most and only for the
// fields whose value actually changes, through whichever lane the page is on
// (store/easylane.js). No idle gate: a tile is honored whether or not the
// daemon is playing, which is the binding product rule.
import { html } from "../../lib/dom.js";
import { Segment } from "../controls/index.js";
import { Apod } from "../controls/apod.js";
import { easyProse, paragraphs } from "../../store/prose.js";
import { rememberKnobs } from "../../store/easyview.js";
import { filterFor, writeSet } from "../../store/easy.js";
import { knobsOffered } from "../../store/easyoffer.js";
import { pipsFor } from "../../store/easycost.js";
import { easyLane } from "../../store/easylane.js";
import { sourceIsNx } from "../../store/live/derive.js";
import { plainEntry } from "../../store/plainnames.js";
import { filterFacets } from "../../store/narrow/facets.js";
import { MARK_LABEL } from "./marks.js";

// The hi-res badge's two strings. Constants rather than copy read through
// `easyProse`, for the reason marks.js gives about its own labels: prose arrives
// with the metadata and is empty until it does, and a badge sourced from it
// would paint an empty pill on first render and fill in a moment later.
//
// One string serves as both the hover tip and the badge's accessible name. The
// badge reads "Hi-Res", which names the thing without saying anything about it,
// so the sentence is what a screen reader should hear.
const HIRES_LABEL = "Hi-Res";
const HIRES_TIP =
  "Uses a special hi-res-optimized filter at rates above 48 kHz; these filters can also be used for Lossy content";

/**
 * @typedef {import("../../store/easy.js").Preset} Preset
 * @typedef {import("../../store/easy.js").Knob} Knob
 */

// The fields go one at a time because both lanes write one at a time: staging
// returns the whole pending set on each POST, and a live write re-mirrors the
// engine behind it. Sequential is the honest shape of both.
/**
 * Write one preset's filters at the given knob positions, through this page's lane.
 *
 * @param {string} lane
 * @param {Preset} preset
 * @param {Record<string, string>} knobs
 * @returns {Promise<void>}
 */
async function applyPreset(lane, preset, knobs) {
  // Recorded before the write, not after: the positions are what the user asked
  // for, and a write that resolves no filter name still leaves the tile showing
  // where they put its knobs. Unconditional, so a press that writes nothing
  // still moves the record. The card's knobs are the card's, so the record
  // keeps the tile's own.
  const own = Object.fromEntries(
    Object.entries(knobs).filter(([id]) => !preset.knobs.some((k) => k.card && k.id === id)),
  );
  rememberKnobs(preset.id, own);
  const l = easyLane(lane);
  for (const [key, name] of Object.entries(writeSet(preset.id, l.mode, knobs))) {
    // A field already holding this filter is skipped. On LIVE every write is a
    // POST the engine acts on, so writing a value a field already holds reloads
    // that filter and interrupts playback to arrive where it already was.
    // This is not an idle gate: the button is never disabled and never refuses,
    // and the state a press leaves behind is the state it names.
    if (l.values[key] === name) continue;
    await l.write(key, name);
  }
}

// Which mark a tile wears. The filters a preset writes all share one apodizing
// class — checked across the whole table, 1x and Nx, PCM and SDM, `-2s` and
// plain — so any one of them answers for the tile, and the PCM chain is asked
// rather than this page's actual output mode. That keeps the mark off the lane
// entirely: building one per tile per render to learn a mode all four fields
// agree on is work for an answer already known.
//
// Derived from the same facet map the health card reads (store/health.js), not
// from a table here: apodizing is a fact about a filter, and a preset naming it
// again is a second place to keep true.
/**
 * @param {string} presetId
 * @param {Record<string, string>} knobs
 * @returns {"full" | "half" | "none" | undefined} undefined when nothing is known about the filter
 */
function markFor(presetId, knobs) {
  const name = Object.values(writeSet(presetId, "pcm", knobs))[0];
  const facet = name ? filterFacets.value[name] : undefined;
  if (!facet) return undefined;
  if (facet.apodizing) return "full";
  return facet.apodizingHalf ? "half" : "none";
}

// A knob's positions are the preset's own option ids; their words come from the
// same file the titles do, keyed by knob id and option id. Moving one writes the
// preset at the new position, so moving a knob on a tile that is not lit lights
// it — there is no separate "select" step and nothing to select into.
// A knob may carry a tip: one sentence about what its positions cost, for the
// knobs where the choice is not self-evident from the two words on the segment.
// The words are shown on hover and named as the knob's description, so the tip
// reaches a screen reader rather than only a pointer. The id is preset and knob,
// which is unique in the grid because a preset appears in it once.
//
// A position may carry a tip of its own, saying what picking that one does. That
// copy is keyed by knob and option alone, outside any preset: the same 'Space'
// means the same thing on every tile that offers it, and a paragraph repeated
// under eight presets is eight places to keep true. A knob whose positions have
// no tip copy hands the segment empty strings, which render nothing.
/** @param {{ preset: Preset, knob: Knob, knobs: Record<string, string>, lane: string }} props */
function KnobRow({ preset, knob, knobs, lane }) {
  const options = knob.options.map((id) => ({
    value: id,
    label: easyProse(preset.id, "knobs", knob.id, "options", id),
    tip: easyProse("tips", knob.id, id),
  }));
  const tip = easyProse(preset.id, "knobs", knob.id, "tip");
  const base = `easy-knob-${preset.id}-${knob.id}`;
  return html`
    <div
      class="easy-knob"
      data-knob=${knob.id}
      role="group"
      aria-labelledby=${`${base}-label`}
      aria-describedby=${tip ? `${base}-tip` : undefined}
    >
      <span class="t-label" id=${`${base}-label`}>
        ${easyProse(preset.id, "knobs", knob.id, "label")}
      </span>
      ${tip && html`<span class="easy-knob-tip" id=${`${base}-tip`}>${tip}</span>`}
      <${Segment}
        value=${knobs[knob.id]}
        options=${options}
        idBase=${base}
        onChange=${(/** @type {string | number} */ v) => applyPreset(lane, preset, { ...knobs, [knob.id]: String(v) })}
      />
    </div>
  `;
}

// What the preset costs the machine, as pips, on the row the apodizing mark
// already occupies. The number comes from the lane's own output mode, unlike the
// mark: cost is the one thing on a tile that genuinely differs between the two
// chains, which is what there is to say.
//
// The pips are drawn, so the count they stand for reaches a screen reader as
// the row's own name and never as thirteen unlabeled marks. The group keeps the
// visible word beside them, so the two together say what a sighted reader sees:
// "Cost", then "13 pips".
// How many pips stand in a row. Up to seven they all fit on one; past that they
// break into two EVEN rows, so twelve reads 6 over 6 and thirteen 7 over 6. A
// fixed seven-wide grid would have left twelve as 7 over 5, which reads as a
// dropped pip rather than as one row less.
/**
 * @param {number} count
 * @returns {number}
 */
const pipColumns = (count) => (count <= 7 ? Math.max(count, 1) : Math.ceil(count / 2));

/** @param {{ preset: Preset, lane: string, knobs: Record<string, string> }} props */
function Pips({ preset, lane, knobs }) {
  // A costText preset ranks against nothing, so its row says a word where the
  // others count pips. The word is owner copy (prose key "cost"), the label the
  // same one the dots get.
  if (preset.costText) {
    return html`
      <span class="easy-pips" data-testid="easy-pips">
        <span class="t-label">Cost:</span>
        <span class="t-label">${easyProse(preset.id, "cost")}</span>
      </span>
    `;
  }
  const count = pipsFor(preset.id, easyLane(lane).mode, knobs);
  const labelId = `easy-pips-${preset.id}-label`;
  return html`
    <span class="easy-pips" data-testid="easy-pips" role="group" aria-labelledby=${labelId}>
      <span class="t-label" id=${labelId}>Cost:</span>
      <span
        class="easy-pips-dots"
        role="img"
        aria-label=${`${count} ${count === 1 ? "pip" : "pips"}`}
        style=${`--pip-cols: ${pipColumns(count)}`}
      >
        ${Array.from({ length: count }, (_, i) => html`<span class="easy-pip" data-pip="" key=${String(i)}></span>`)}
      </span>
    </span>
  `;
}

// What the tile actually writes, named. The raw engine name first, because that
// is the string a user carries to the manual, to a forum post, or to the chain
// card's own dropdown; the overlay's breakdown under it, because the raw name is
// a compound nobody should have to parse to learn what family they are in.
//
// The three descriptor lines are the plain-names overlay's own fields
// (data/filter-plain-names.json) and nothing derived here: family, variant and
// leaf already exist as owner-edited copy, and re-deriving phase or length from
// the name would be a second place to keep true — one that reads blank on the
// hi-res filters, whose names carry no length token at all.
//
// A name the overlay does not carry renders alone. Every filter the six presets
// can write has a row today; a filter arriving without one shows the engine's
// name and no invented breakdown, the same answer the dropdowns give.
/** @param {{ presetId: string, lane: string, knobs: Record<string, string> }} props */
function FilterName({ presetId, lane, knobs }) {
  const name = filterFor(presetId, easyLane(lane).mode, knobs, sourceIsNx());
  if (!name) return null;
  const plain = plainEntry("filters", name);
  return html`
    <span class="easy-filter" data-testid="easy-filter">
      <span class="easy-filter-raw" data-part="raw">${name}</span>
      ${plain && plain.family && html`<span class="easy-filter-line" data-part="family">${plain.family} family</span>`}
      ${plain && plain.variant && html`<span class="easy-filter-line" data-part="class">${plain.variant} class</span>`}
      ${plain && html`<span class="easy-filter-line" data-part="shape">${plain.leaf}</span>`}
    </span>
  `;
}

// The picking half is a button and the knobs are outside it, because a button
// inside a button is not markup a browser will keep. So the tile is the box, the
// button is everything that means "this preset", and the knobs sit under it.
//
// Inside the button, the mark and the title are one group and the description is
// the button's other child. That grouping exists so the gap between the name and
// the prose can differ from the gap between the emoji and the name — space
// between siblings is the parent's gap and nothing else (docs/design-system.md),
// so two spacings mean two parents.
// GRAYED is a third marking and the only one the card decides rather than the
// fields: the card's material knob says the source is lossy and this preset has
// no filter made for it (store/easyoffer.js presetGrayed). It dims the tile and
// nothing else — the button still works, because a user action always proceeds.
/**
 * One curated preset as a tile: its mark, its cost, its words, its adjustments, and the click that sets it.
 * @param {{ preset: Preset, lane: string, selected: boolean, active: boolean, grayed?: boolean, knobs: Record<string, string> }} props
 */
export function PresetTile({ preset, lane, selected, active, grayed, knobs }) {
  const mark = markFor(preset.id, knobs);
  return html`
    <div
      class="easy-tile"
      data-preset=${preset.id}
      data-selected=${selected ? "1" : "0"}
      data-active=${active ? "1" : "0"}
      data-grayed=${grayed ? "1" : undefined}
    >
      <button type="button" class="easy-pick" onClick=${() => applyPreset(lane, preset, knobs)}>
        <span class="easy-mark">
          <span class="easy-name">
            <span class="easy-emoji" aria-hidden="true">${preset.emoji}</span>
            <span class="easy-title t-head">${easyProse(preset.id, "title")}</span>
          </span>
          <span class="easy-cost">
            <span class="easy-cost-marks">
              ${
                mark &&
                html`<span class="easy-apod" data-mark=${mark} data-tip=${MARK_LABEL[mark]}>
                <${Apod} kind=${mark} label=${MARK_LABEL[mark]} />
              </span>`
              }
              ${mark && preset.hires && html`<span class="easy-cost-rule" aria-hidden="true"></span>`}
            </span>
            ${
              preset.hires
                ? html`<span
                    class="easy-hires"
                    data-testid="easy-hires"
                    role="img"
                    aria-label=${HIRES_TIP}
                    data-tip=${HIRES_TIP}
                    >${HIRES_LABEL}</span
                  >`
                : html`<span class="easy-cost-rule" aria-hidden="true"></span>`
            }
            <span class="easy-cost-tail">
              ${preset.hires && html`<span class="easy-cost-rule" aria-hidden="true"></span>`}
              <${Pips} preset=${preset} lane=${lane} knobs=${knobs} />
            </span>
          </span>
        </span>
        <span class="easy-desc t-label">
          ${paragraphs(easyProse(preset.id, "description")).map(
            (para, i) => html`<span data-para=${String(i)}>${para}</span>`,
          )}
        </span>
        <${FilterName} presetId=${preset.id} lane=${lane} knobs=${knobs} />
      </button>
      <span class="easy-knobs">
        ${knobsOffered(preset, knobs, easyLane(lane).mode).map(
          (knob) => html`<${KnobRow} preset=${preset} knob=${knob} knobs=${knobs} lane=${lane} />`,
        )}
      </span>
    </div>
  `;
}
