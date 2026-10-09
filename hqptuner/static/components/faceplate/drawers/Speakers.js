// The Speakers drawer's block, under its switch row. Left: the speaker set (which channels the drawer lists; a view
// choice that never stages), then one row per listed channel with its level (dBFS) and distance (cm) boxes. Right:
// v1's top-down room plan, the listener facing up the page and each listed speaker the model places (one with a
// distance or level entered) at its layout angle, toed in, at a radius set by its own distance, its level riding as a
// label; the box fits the placed speakers, centred on the listener. While Direct SDM runs the level boxes are dead and
// v1's line says why; distances stay live. Edits are held by store/faceplate/drawers/speakers.js, which decides
// everything drawn here.

import { useEffect } from "preact/hooks";
import { html, TypedInput } from "../../../lib/dom.js";
import { minus } from "../../../model/shell/format.js";
import { HEAD, placeSpeakers, planExtent } from "../../../model/gauges/speakers.js";
import { loadSpeakers, speakers, speakersBusy, speakersError } from "../../../store/matrix/speakers.js";
import {
  DIRECT_SDM_NOTE as DIRECT_SDM,
  SETS,
  levelsDead,
  pickSpeakerSet,
  setChannelDistance,
  setChannelLevel,
  speakerDraft,
} from "../../../store/faceplate/drawers/speakers.js";
import { withXref } from "../Xref.js";

/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawers/speakers.js").DraftChannel} DraftChannel */
/** @typedef {import("../../../store/faceplate/drawers/speakers.js").BoxLimits} BoxLimits */
/** @typedef {import("../../../model/gauges/speakers.js").Spot} Spot */
/** @typedef {{ currentTarget: { value: string } }} ChangeEv */

/** Each channel's angle on the plan, degrees clockwise from front, in the daemon's order (v1 Diagram.js). */
const LAYOUT = [-30, 30, 0, -55, -145, 145, -90, 90];
/** Each channel's tag on the plan, in the daemon's order (v1 Diagram.js). */
const SHORT = ["L", "R", "C", "Sub", "Lr", "Rr", "Ls", "Rs"];
/** How far the listener's nose reaches past the head. */
const NOSE = 5;

// v1 copy (owner): components/speakers/Card.js.
const LOADING = "Loading speaker processing…";

/**
 * One number box, its unit after it, drafting what it is changed to.
 *
 * @param {{ value: number, limits: BoxLimits, unit: string, aria: string, disabled: boolean, set: (v: string) => void }} p
 */
function numBox({ value, limits, unit, aria, disabled, set }) {
  return html`
    <div class="num">
      <${TypedInput}
        type="number"
        class="vfd"
        aria-label=${aria}
        value=${value}
        min=${limits.min}
        max=${limits.max}
        step=${limits.step}
        disabled=${disabled}
        onChange=${(/** @type {ChangeEv} */ e) => set(e.currentTarget.value)}
      />
      <span class="u">${unit}</span>
    </div>
  `;
}

/**
 * One channel's row: its name, its level box and its distance box.
 *
 * @param {DraftChannel} c
 * @param {{ dead: boolean, busy: boolean }} s
 */
function channelRow(c, { dead, busy }) {
  return html`
    <div class="sprow" data-ch=${c.index}>
      <span class="spn">${c.name}</span>
      ${numBox({
        value: c.level,
        limits: { step: 0.1, ...c.levelBox },
        unit: "dBFS",
        aria: `${c.name} level`,
        disabled: dead || busy,
        set: (v) => setChannelLevel(c.index, v),
      })}
      ${numBox({
        value: c.distance,
        limits: { step: 1, ...c.distanceBox },
        unit: "cm",
        aria: `${c.name} distance`,
        disabled: busy,
        set: (v) => setChannelDistance(c.index, v),
      })}
    </div>
  `;
}

/**
 * The speaker-set select, the set on view selected.
 *
 * @param {string} set
 * @param {boolean} busy
 */
function setSelect(set, busy) {
  return html`
    <label class="ci">
      <span class="cl">Speaker set</span>
      <select
        class="vfd spset"
        aria-label="Speaker set"
        disabled=${busy}
        onChange=${(/** @type {ChangeEv} */ e) => pickSpeakerSet(e.currentTarget.value)}
      >
        ${SETS.map((s) => html`<option value=${s.id} selected=${s.id === set}>${s.label}</option>`)}
      </select>
    </label>
  `;
}

/**
 * A speaker seen from above, turned to its angle: the cabinet with its driver, or a square box for the sub.
 *
 * @param {Spot} p
 */
function speakerGlyph(p) {
  return html`
    <g transform=${`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.deg})`}>
      ${
        p.sub
          ? html`<rect x="-9" y="-9" width="18" height="18" rx="2" />`
          : html`<rect x="-10" y="-8" width="20" height="16" rx="2" /><circle class="drv" cx="0" cy="3.5" r="3" />`
      }
    </g>
  `;
}

/**
 * The room plan: the listener at the centre and each speaker the model places at its drafted distance, its tag and
 * level under it, the box fitted to them.
 *
 * @param {DraftChannel[]} listed
 */
function roomPlan(listed) {
  /** @type {number[]} */
  const distances = [];
  /** @type {number[]} */
  const levels = [];
  for (const c of listed) {
    distances[c.index] = c.distance;
    levels[c.index] = c.level;
  }
  const byIndex = new Map(listed.map((c) => [c.index, c]));
  const spots = placeSpeakers(
    listed.map((c) => c.index),
    LAYOUT,
    distances,
    levels,
  );
  const r = planExtent(spots);
  return html`
    <svg class="spplan" role="img" aria-label="Room plan" viewBox=${`${-r} ${-r} ${2 * r} ${2 * r}`}>
      <circle class="head" cx="0" cy="0" r=${HEAD} />
      <path class="nose" d=${`M-4,${1 - HEAD} L0,${-HEAD - NOSE} L4,${1 - HEAD}`} />
      ${spots.map((p) => {
        const c = /** @type {DraftChannel} */ (byIndex.get(p.i));
        return html`
          <g class="spk" data-ch=${p.i}>
            ${speakerGlyph(p)}
            <text class="sl" x=${p.x} y=${p.y + 22} text-anchor="middle">${SHORT[p.i] ?? c.name}</text>
            <text class="sv" x=${p.x} y=${p.y + 33} text-anchor="middle">${minus(c.level, 1)}</text>
          </g>
        `;
      })}
    </svg>
  `;
}

/**
 * The Speakers drawer's block: the set and the listed channels' boxes beside the room plan. It reads the daemon's
 * form the first time it is drawn, if nothing has yet.
 *
 * @param {{ schema: DrawerSchema, here: XrefHere }} props  here: where it is drawn
 */
export function SpeakersBody({ here }) {
  useEffect(() => {
    if (speakers.value === null) loadSpeakers();
  }, []);
  const d = speakerDraft();
  const err = speakersError.value;
  if (!d.loaded) return html`<p class="dintro">${err || LOADING}</p>`;
  const dead = levelsDead();
  const busy = speakersBusy.value;
  const byIndex = new Map(d.channels.map((c) => [c.index, c]));
  const listed = d.shown.flatMap((i) => byIndex.get(i) ?? []);
  return html`
    <div class="spbody">
      <div class=${dead ? "spleft sdm" : "spleft"}>
        ${setSelect(d.set, busy)}
        <div class="sprows">${listed.map((c) => channelRow(c, { dead, busy }))}</div>
        ${dead ? html`<p class="spsdm">${withXref(DIRECT_SDM, here)}</p>` : null}
        ${
          err
            ? html`<p class="aline" data-sev="crit"><span class="ag" aria-hidden="true">⚠</span><span>${err}</span></p>`
            : null
        }
      </div>
      <div class="spright">${roomPlan(listed)}</div>
    </div>
  `;
}
