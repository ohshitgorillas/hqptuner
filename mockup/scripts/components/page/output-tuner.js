// Page Output section: the rate picker. It exists only while Settings → Behavior → Allow pinned rates is On (the page holds
// engaged stages with a job on the page; with pins off the Output stage has none: the rail shows the format, the Output
// drawer sets it). The output rate is the whole subject: no source mark, no ratio, no mode control.
//   Glass    two rows. Head column (`Auto` | `44.1k · 48k`) | one column per tier of the running band: the tier name, then
//            its two exact rates side by side (44.1k family first, as the head says) with the tier's unit once after the
//            pair, each rate a live pin (SetRate): one tap, one exact rate. Hatched where the device can't carry the tier.
//            The other band never shows (output mode is the station's: Setting Switcher, Output drawer). Two rows, not
//            three: the 20px go to the Source spectrum at 10.2″ (the page's overflow order, after the option copy).
//   Marks    the rate playing is ringed (ink: a measurement); the pin (or `Auto`, no pin) reads in accent (a setting).
//            Pinned, the pin is what plays: accent and ringed. Nothing playing: no ring.

import { h } from "../../lib/shell/dom.js";
import { classNames } from "../../../../hqptuner/static/model/shell/format.js";
import { tunerColumns } from "../../../../hqptuner/static/model/gauges/output.js";

/** @typedef {'f44' | 'f48'} Fam  a rate family */
/** @typedef {{ tier: number, fam: Fam }} Pin  a pinned rate: its tier and family */
/** @typedef {{ family: string, name: string, f44: string, f48: string, unit: string, unavailable?: boolean }} Tier */
/** @typedef {{ run: string, tier: number | null, src: number | null, fam: string }} Now  what runs */

/**
 * One mounted tuner, shared by the helpers below.
 *
 * @typedef {object} Tuner
 * @property {HTMLElement} section  the page's Output section
 * @property {{ tiers: Tier[] }} rt  RATE_TIERS
 * @property {(pin: Pin | null) => void} onPin
 * @property {Now} st
 * @property {boolean} allowed  Allow pinned rates
 * @property {Pin | null} pin
 * @property {HTMLElement} auto
 * @property {HTMLElement} grid
 */

/** @type {[Fam, string][]} */
const FAMS = [
  ["f44", "44.1k"],
  ["f48", "48k"],
];

/**
 * One tier's column: its name, its two exact rates (each a pin, hatched where the device can't carry it) and its unit.
 *
 * @param {Tuner} t
 * @param {import('../../../../hqptuner/static/model/gauges/output.js').TunerColumn} c
 */
function column(t, { i, cells }) {
  const tier = t.rt.tiers[i];
  const pair = h("div.otpair", {});
  const col = h("div.otcol", { class: tier.unavailable && "otunav" }, h("span.ottn", { text: tier.name }), pair);
  for (const { fam, pinned: on, playing: play } of cells) {
    const f = /** @type {Fam} */ (fam);
    if (tier.unavailable) {
      pair.append(h("span.otp.otno", { text: tier[f] }));
      continue;
    }
    pair.append(
      h(
        "button.otp",
        {
          type: "button",
          class: classNames(on && "otpinned", play && "otplay"),
          aria: { pressed: on, label: `Pin ${tier[f]} ${tier.unit}${play ? ", playing" : ""}` },
          on: {
            click: () => {
              t.pin = { tier: i, fam: f };
              t.onPin({ ...t.pin });
              paint(t);
            },
          },
        },
        tier[f],
      ),
    );
  }
  pair.append(h("span.otu", { class: tier.unavailable && "otno", text: tier.unit })); // the tier's unit, once for the pair
  return col;
}

/** @param {Tuner} t */
function paint(t) {
  t.section.hidden = !t.allowed;
  if (!t.allowed) return;
  const cols = tunerColumns(
    t.rt.tiers,
    t.st,
    t.pin,
    FAMS.map(([f]) => f),
  );
  t.grid.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
  t.grid.replaceChildren(...cols.map((c) => column(t, c)));
  t.auto.classList.toggle("otpinned", !t.pin);
  t.auto.setAttribute("aria-pressed", String(!t.pin));
}

/**
 * The page's Output rate picker: `Auto`, or one exact rate of the running band pinned.
 *
 * @param {HTMLElement} host   #oglass, inside the page's Output section
 * @param {{ tiers: Tier[] }} rt          RATE_TIERS
 * @param {{onPin: (pin: Pin | null) => void, bus: import('../../lib/shell/bus.js').Bus}} o
 */
export function mountOutputTuner(host, rt, { onPin, bus }) {
  /** @type {Tuner} */
  const t = {
    section: /** @type {HTMLElement} */ (host.closest("section")),
    rt,
    onPin,
    st: { run: "sdm", tier: null, src: null, fam: "f44" },
    allowed: false,
    pin: null,
    auto: h(
      "button.otautop",
      {
        type: "button",
        on: {
          click: () => {
            t.pin = null;
            onPin(null);
            paint(t);
          },
        },
      },
      "Auto",
    ),
    grid: h("div.otgrid"),
  };
  const heads = h("div.otheads", {}, t.auto, h("span.otfh", { text: FAMS.map(([, l]) => l).join(" · ") }));
  host.replaceChildren(h("div.vfd.otglass", { role: "group", "aria-label": "Output rate" }, heads, t.grid));

  return {
    /**
     * What runs (conversion.js, every render): the running band, the output tier, the source tier (null: nothing plays),
     * the source's base family (f44 | f48: auto rate family follows it).
     *
     * @param {Now} next
     */
    set(next) {
      if (next.run !== t.st.run && t.pin) {
        t.pin = null;
        onPin(null);
      } // a pin is a rate of the running band
      t.st = next;
      paint(t);
    },
    /**
     * Settings → Behavior → Allow pinned rates: On shows the section; Off hides it and clears the pin.
     *
     * @param {boolean} on
     */
    allow(on) {
      t.allowed = on;
      if (!on && t.pin) {
        t.pin = null;
        onPin(null);
      }
      paint(t);
      bus.emit("relayout"); // the page refits around the section
    },
  };
}
