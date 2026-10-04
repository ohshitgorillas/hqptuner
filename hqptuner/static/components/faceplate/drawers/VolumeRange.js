// The Volume drawer's Range block: HQPTuner v1's range bar on the faceplate. Min, Startup and Max on one shared dBFS
// axis, so the relationship three separate boxes never stated is drawn: the span between the brackets is the range the
// engine will allow at runtime. Under the bar, the typed boxes and the Playback readout beside the settings'
// paragraphs, then the loudness bounds, read-only here since they are Loudness settings, beside theirs. Every mark on
// the bar is named once, beside its own glyph; a readout shows only while its mark is on the bar.
//
// Edits stage through the store (store/faceplate/drawers/volume.js), so they mark the tab through the drawer. The
// block grays whole while Fixed volume is not Off. The `Loudness ›` line prints its text: its link to the Loudness
// drawer is a later phase's.

import { html } from "../../../lib/dom.js";
import { AXIS_MAX, AXIS_MIN } from "../../../lib/volume.js";
import { signed } from "../../../model/shell/format.js";
import { schema as catalog } from "../../../store/schema.js";
import { describe } from "../../../store/prose.js";
import { RANGE_KEYS, volumeRangeNow } from "../../../store/faceplate/drawers/volume.js";
import { RangeBar } from "./volume/Bar.js";
import { RangeBox, Readout } from "./volume/marks.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawers/volume.js").VolumeKey} VolumeKey */
/** @typedef {import("../../../store/faceplate/drawers/volume.js").VolumeTrio} VolumeTrio */
/** @typedef {import("../../../store/faceplate/drawers/volume.js").VolumeRangeView} VolumeRangeView */
/** @typedef {import("./volume/marks.js").KeyGlyph} KeyGlyph */

/** The volume row's paragraphs, in the mockup's order. */
const VOLUME_MAN = [RANGE_KEYS.min, RANGE_KEYS.max, RANGE_KEYS.startup];
const LOUD_MAN = ["loudness_range_low", "loudness_range_high"];

/**
 * Each setting's paragraph from the settings metadata, its label bolded ahead of it.
 *
 * @param {{ keys: string[] }} props
 */
const Manual = ({ keys }) => html`
  <div class="man">
    ${keys.map((k) => {
      const { label, tooltip } = describe(catalog[k], k);
      return html`<p><b>${label}</b> ${tooltip}</p>`;
    })}
  </div>
`;

/**
 * The three typed boxes, each fenced as its handle is: Min on the axis and at most 0 dB and Startup, Startup between
 * Min and Max, Max from Startup to the top of the axis.
 *
 * @type {{ k: VolumeKey, glyph: KeyGlyph, label: string, fence: (cur: VolumeTrio) => [number, number] }[]}
 */
const BOXES = [
  { k: "min", glyph: "min", label: "Min", fence: (cur) => [AXIS_MIN, Math.min(0, cur.startup)] },
  { k: "startup", glyph: "pin", label: "Startup", fence: (cur) => [cur.min, cur.max] },
  { k: "max", glyph: "max", label: "Max", fence: (cur) => [cur.startup, AXIS_MAX] },
];

/**
 * The volume row: the boxes and the Playback readout over the gray reason, the settings' paragraphs beside.
 *
 * @param {{ view: VolumeRangeView }} props
 */
function VolumeRow({ view }) {
  const { cur, gray, dirty, level } = view;
  return html`
    <div class="vrrow">
      <div class="vrctl">
        <div class="vrboxes">
          ${BOXES.map(({ k, glyph, label, fence }) => {
            const [min, max] = fence(cur);
            return html`<${RangeBox}
              k=${k}
              setting=${RANGE_KEYS[k]}
              glyph=${glyph}
              label=${label}
              value=${cur[k]}
              min=${min}
              max=${max}
              dirty=${dirty[k]}
              disabled=${!!gray}
            />`;
          })}
          <${Readout}
            glyph="needle"
            label="Playback"
            text=${level === null ? "" : signed(level, 1)}
            unit="dB"
            live=${true}
            hidden=${level === null}
          />
        </div>
        ${gray ? html`<span class="gr">${gray}</span>` : null}
      </div>
      <${Manual} keys=${VOLUME_MAN} />
    </div>
  `;
}

/**
 * The loudness row: its bounds read-only, shown while loudness reaches the output, the `Loudness ›` line as its text,
 * the bounds' paragraphs beside.
 *
 * @param {{ loud: VolumeRangeView["loud"] }} props
 */
const LoudnessRow = ({ loud }) => html`
  <div class="vrrow vrloud">
    <div class="vrctl">
      <div class="fh">
        <b>Loudness bounds</b>
        <span>Loudness<span aria-hidden="true"> ›</span></span>
      </div>
      <div class="vrboxes inl" hidden=${!loud}>
        <${Readout} glyph="lparen" label="Lower" text=${loud ? signed(loud.low) : ""} unit="dBFS" />
        <${Readout} glyph="rparen" label="Upper" text=${loud ? signed(loud.high) : ""} unit="dBFS" />
      </div>
    </div>
    <${Manual} keys=${LOUD_MAN} />
  </div>
`;

/**
 * The Range block's body: the bar, the volume row and the loudness row.
 *
 * @param {{ schema: DrawerSchema }} _props  the drawer it is mounted in
 */
export function VolumeRangeBody(_props) {
  const view = volumeRangeNow();
  return html`
    <div class=${view.gray ? "vrange grayed-range" : "vrange"}>
      <div class="fh"><b>Range</b></div>
      <${RangeBar} view=${view} />
      <${VolumeRow} view=${view} />
      <${LoudnessRow} loud=${view.loud} />
    </div>
  `;
}
