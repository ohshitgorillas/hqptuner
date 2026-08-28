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
import { writeSet } from "../../store/easy.js";
import { easyLane } from "../../store/easylane.js";
import { filterFacets } from "../../store/narrow/facets.js";
import { MARK_LABEL } from "./marks.js";

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
 * @param {string} grid
 * @param {string} presetId
 * @param {Record<string, string>} knobs
 * @returns {Promise<void>}
 */
async function applyPreset(lane, grid, presetId, knobs) {
  // Recorded before the write, not after: the positions are what the user asked
  // for, and a write that resolves no filter name still leaves the tile showing
  // where they put its knobs. Unconditional, so a press that writes nothing
  // still moves the record.
  rememberKnobs(grid, presetId, knobs);
  const l = easyLane(lane);
  for (const [key, name] of Object.entries(writeSet(grid, presetId, l.mode, knobs))) {
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
 * @param {string} grid
 * @param {string} presetId
 * @param {Record<string, string>} knobs
 * @returns {"full" | "half" | "none" | undefined} undefined when nothing is known about the filter
 */
function markFor(grid, presetId, knobs) {
  const name = Object.values(writeSet(grid, presetId, "pcm", knobs))[0];
  const facet = name ? filterFacets.value[name] : undefined;
  if (!facet) return undefined;
  if (facet.apodizing) return "full";
  return facet.apodizingHalf ? "half" : "none";
}

// A knob's positions are the preset's own option ids; their words come from the
// same file the titles do, keyed by knob id and option id. Moving one writes the
// preset at the new position, so moving a knob on a tile that is not lit lights
// it — there is no separate "select" step and nothing to select into.
/** @param {{ grid: string, preset: Preset, knob: Knob, knobs: Record<string, string>, lane: string }} props */
function KnobRow({ grid, preset, knob, knobs, lane }) {
  const options = knob.options.map((id) => ({
    value: id,
    label: easyProse(grid, preset.id, "knobs", knob.id, "options", id),
  }));
  return html`
    <div class="easy-knob" data-knob=${knob.id}>
      <span class="t-label">${easyProse(grid, preset.id, "knobs", knob.id, "label")}</span>
      <${Segment}
        value=${knobs[knob.id]}
        options=${options}
        onChange=${(/** @type {string | number} */ v) =>
          applyPreset(lane, grid, preset.id, { ...knobs, [knob.id]: String(v) })}
      />
    </div>
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
/**
 * One curated preset as a tile: its mark, its words, its adjustments, and the click that sets it.
 * @param {{ grid: string, preset: Preset, lane: string, active: boolean, knobs: Record<string, string> }} props
 */
export function PresetTile({ grid, preset, lane, active, knobs }) {
  const mark = markFor(grid, preset.id, knobs);
  return html`
    <div class="easy-tile" data-preset=${preset.id} data-active=${active ? "1" : "0"}>
      <button type="button" class="easy-pick" onClick=${() => applyPreset(lane, grid, preset.id, knobs)}>
        <span class="easy-mark">
          <span class="easy-emoji" aria-hidden="true">${preset.emoji}</span>
          <span class="easy-title t-head">${easyProse(grid, preset.id, "title")}</span>
          ${
            mark &&
            html`<span class="easy-apod" data-mark=${mark} data-tip=${MARK_LABEL[mark]}>
            <${Apod} kind=${mark} label=${MARK_LABEL[mark]} />
          </span>`
          }
        </span>
        <span class="easy-desc t-label">
          ${paragraphs(easyProse(grid, preset.id, "description")).map(
            (para, i) => html`<span data-para=${String(i)}>${para}</span>`,
          )}
        </span>
      </button>
      ${preset.knobs.map(
        (knob) => html`<${KnobRow} grid=${grid} preset=${preset} knob=${knob} knobs=${knobs} lane=${lane} />`,
      )}
    </div>
  `;
}
