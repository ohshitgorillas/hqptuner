// Settings: the gear swaps the chain body (rail + page + stage drawers) for the settings body. Header, engine row and Setting
// Switcher stay (the engine row shows what Hardware acceleration does to the process speed and buffers).
//   Rail    one entry per category, the chain's stage grammar minus wire and lamps: engraved name, then that drawer's
//           settings as readouts (label | value), left-hand amber selection bar while its drawer is open. Opens its drawer.
//   Drawers drawer.js schemas (data/settings/), the chain drawers' shell, rows and apply group. Timing, Hardware
//           acceleration and the log rows stage (restart lanes); Visual settings apply at once.
//   Page    About (engine identity, Backup / restore) + About HQPTuner: read-only, so the page under the drawers.
// Exit: the gear again, or Escape with no drawer or popover open. Entering or leaving closes every drawer.
// Readouts follow staged rows on Apply, live rows at once (the chain rail's rule).

import { h } from "../../lib/shell/dom.js";
import { PLATFORM } from "../../lib/shell/clock.js";
import { revertAfter } from "../../model/shell/timing.js";
import { rowsOf } from "../../model/builders/schema.js";
import { readoutOf, effectOf } from "../../model/shell/settings.js";
import { secHead, manPara } from "../../lib/controls/controls.js";
import { swapBody, escapeLeaves } from "../../lib/builder/builder.js";
import { mountDrawer } from "../drawers/drawer.js";
import { setOptionStyle } from "../lists/vselect.js";
import { mountSignalPath, PATH_NAME } from "./signal-path.js";
import { SETTINGS_RAIL, READOUT_LABEL } from "../../data/settings/rail.js";
import { ABOUT } from "../../data/settings/about.js";
import { LOG_TAIL } from "../../data/settings/logging.js";
import { ACCENTS, HIDEABLE } from "../../data/settings/visual.js";
import { MIRROR } from "../../data/settings/hardware.js";

/** @typedef {import('../../lib/shell/bus.js').Bus} Bus */
/** @typedef {import('../../lib/shell/clock.js').Clock} Clock */
/** @typedef {import('../../model/shell/settings.js').Control & { id?: string, value?: string | number, items?: SettingControl[] }} SettingControl */
/** @typedef {{ label?: string, live?: boolean, control: SettingControl }} SettingRow */
/** @typedef {(typeof SETTINGS_RAIL)[number]} Category */
/** @typedef {{ dd: HTMLElement, fmt: (v: string) => string | [HTMLElement, string] }} Readout  a readout's value cell and how it prints */
/**
 * @typedef {object} RailCtx  what a category's rail entry and drawer share with the rest of Settings
 * @property {HTMLElement} body
 * @property {HTMLElement} rail
 * @property {Bus} bus
 * @property {Clock} clock
 * @property {Map<string, Readout>} readouts  control id → its readout
 * @property {(id: string, v: string) => void} show  print a value in its readout
 */

/**
 * Mount Settings: the rail and its drawers, one per category, the About page, and the gear that swaps them in for the
 * chain body.
 *
 * @param {{gear: HTMLButtonElement, chain: HTMLElement, body: HTMLElement, rail: HTMLElement, page: HTMLElement}} el
 * @param {Bus} bus
 * @param {Clock} [clock]
 * @returns {{setOn: (on: boolean) => void}}
 */
export function mountSettings({ gear, chain, body, rail, page }, bus, clock = PLATFORM) {
  /** @type {Map<string, Readout>} */
  const readouts = new Map(); // control id → {dd, fmt}

  /**
   * @param {string} id
   * @param {string} v
   */
  function show(id, v) {
    const ro = readouts.get(id);
    if (ro) ro.dd.replaceChildren(...[ro.fmt(String(v))].flat());
  }

  // ── Rail ────────────────────────────────────────────────────────────────
  for (const cat of SETTINGS_RAIL) mountCategory(cat, { body, rail, bus, clock, readouts, show });

  mountAbout(page);

  // ── Swap ────────────────────────────────────────────────────────────────
  /** @param {boolean} on */
  function setOn(on) {
    swapBody({ btn: gear, chain, body, bus }, on);
    gear.setAttribute("aria-label", on ? "Close settings" : "Settings");
  }
  gear.setAttribute("aria-pressed", "false");
  gear.setAttribute("aria-label", "Settings");
  gear.addEventListener("click", () => setOn(body.hidden));
  escapeLeaves(body, () => setOn(false));

  return { setOn };
}

/**
 * One category: its rail entry (engraved name over its readouts) and the drawer that entry opens.
 *
 * @param {Category} cat
 * @param {RailCtx} ctx
 */
function mountCategory(cat, { body, rail, bus, clock, readouts, show }) {
  const ctls = controlsOf(cat.drawer);
  const rows = readoutRows(cat, ctls, readouts);
  // A live readout that isn't a setting (Signal path: the path playing now).
  if (cat.live) {
    const dd = h("dd", { text: PATH_NAME.idle });
    bus.on("sigpath", (/** @type {{p: string}} */ d) => {
      dd.textContent = PATH_NAME[d.p] ?? d.p;
    });
    rows.push(h("div", {}, h("dt", { text: cat.live }), dd));
  }
  const btn = h(
    "button.st.sst",
    { type: "button", data: { stage: cat.id } },
    h("span.n", { text: cat.name }),
    h("dl.sro", {}, rows),
  );
  rail.append(btn);

  const live = cat.show.filter((id) => ctlOf(ctls, id).r.live);
  // One setting in two homes (Apply to all stations on both Hardware tabs): a change in one moves the other.
  /** @type {Record<string, string>} */
  const mirror = MIRROR;
  const mirrors = [...ctls.keys()]
    .filter((id) => mirror[id])
    .map((id) => [id, (/** @type {string} */ v) => api.set(mirror[id], v)]);
  const api = mountDrawer(body, btn, cat.drawer, {
    blocks: {
      logtail: (/** @type {HTMLElement} */ host) => logTail(host, clock),
      sigpath: (/** @type {HTMLElement} */ host) => mountSignalPath(host, bus),
    },
    on: Object.fromEntries([
      ...live.map((id) => [
        id,
        (/** @type {string} */ v) => {
          show(id, v);
          effect(id, v, bus);
        },
      ]),
      ...mirrors,
    ]),
    onApply: (/** @type {Record<string, string>} */ v) => {
      for (const id of cat.show) show(id, v[id]);
    },
  });
  api.setOpen(false);
}

/**
 * A category's readouts, one per setting it shows (label | value), each registered so it can follow its setting.
 *
 * @param {Category} cat
 * @param {Map<string, Ctl>} ctls
 * @param {Map<string, Readout>} readouts
 * @returns {HTMLElement[]}
 */
function readoutRows(cat, ctls, readouts) {
  /** @type {Record<string, string>} */
  const labels = READOUT_LABEL;
  return cat.show.map((id) => {
    const { c, label } = ctlOf(ctls, id);
    const dd = h("dd");
    const wide = c.type === "text" || c.type === "toggles"; // own line: a path, a list
    const ro = { dd, fmt: fmtOf(c) };
    readouts.set(id, ro);
    dd.replaceChildren(...[ro.fmt(String(c.value))].flat());
    return h("div", { class: wide && "wide" }, h("dt", { text: labels[id] || label }), dd);
  });
}

/**
 * The page under the drawers. A section's .two takes left | right pairs, one grid row each (Backup / restore | its line);
 * `.span` cells take the row. About HQPlayer (renamed, its read-only line cut, expanded): the identity as a row of
 * labelled VFD windows across the full width (the Rate / Volume window grammar), then Backup / restore | its line.
 * @param {HTMLElement} page
 */
function mountAbout(page) {
  /**
   * @param {string} title
   * @param {...HTMLElement} cells
   */
  const sec = (title, ...cells) =>
    h("section.sec", { "aria-label": title }, secHead("sh", title), h("div.two.pairs", {}, cells));
  page.append(
    sec(
      "About HQPlayer",
      h(
        "div.idrow.span",
        { role: "list", "aria-label": "Engine identity" },
        ABOUT.rows.map(([k, v]) =>
          h("div.vfd", { role: "listitem" }, h("span.l", { text: k }), h("span.v", { text: v })),
        ),
      ),
      h(
        "div.inline.bkup",
        {},
        h("button.btn", { type: "button", text: "Download backup" }),
        h("button.btn", { type: "button", text: "Upload backup" }),
      ),
      h("div.man", {}, manPara({ text: ABOUT.backup })),
    ),
    sec(
      "About HQPTuner",
      h(
        "div.stack",
        {},
        h(
          "span.cap",
          {},
          `HQPTuner ${ABOUT.app} · Released under the `,
          h("a", {
            href: "https://opensource.org/license/mit",
            target: "_blank",
            rel: "noopener noreferrer",
            text: "MIT License",
          }),
          ".",
        ),
      ),
      h(
        "div.man.prose",
        {},
        ABOUT.prose.map((p) =>
          manPara({
            text: [p]
              .flat()
              .map((x) =>
                typeof x === "string"
                  ? x
                  : h("a", { href: x.href, target: "_blank", rel: "noopener noreferrer", text: x.a }),
              ),
          }),
        ),
      ),
    ),
  );
}

/** @typedef {{ c: SettingControl, r: SettingRow, label?: string }} Ctl  a control, the row it sits in, the row's label */

/**
 * Control id → {c, r, label} across a schema (group items included).
 *
 * @param {import('../../model/builders/schema.js').Drawer<SettingRow>} schema
 * @returns {Map<string, Ctl>}
 */
function controlsOf(schema) {
  /** @type {Map<string, Ctl>} */
  const m = new Map();
  for (const r of rowsOf(schema)) {
    const add = (/** @type {SettingControl} */ c) => c.id && m.set(c.id, { c, r, label: r.label });
    add(r.control);
    for (const i of r.control.items || []) add(i);
  }
  return m;
}

/**
 * The control a category shows by id (every id a category shows is one of its drawer's controls).
 *
 * @param {Map<string, Ctl>} ctls
 * @param {string} id
 * @returns {Ctl}
 */
const ctlOf = (ctls, id) => /** @type {Ctl} */ (ctls.get(id));

/**
 * How a readout prints a value (model/settings.js readoutOf): its text, after the accent's swatch where it has one.
 *
 * @param {SettingControl} c
 * @returns {Readout['fmt']}
 */
function fmtOf(c) {
  return (v) => {
    const r = readoutOf(c, v, ACCENTS);
    return r.swatch === null ? r.text : [h("i.sw", { style: `--sw:${r.swatch}` }), r.text];
  };
}

// ── Visual settings that the mock acts on ──────────────────────────────────
// model/settings.js effectOf decides which effect a change causes and its values; this acts on it.
// Bottom bar: swaps the bottom bar (and the engine-row volume). Option style: every chain select's option text (Standard =
// engine names, Simplified = plain titles). Setting / Option descriptions and the Apodizing indicator are not modelled.
/**
 * @param {string} id
 * @param {string} v
 * @param {Bus} bus
 */
function effect(id, v, bus) {
  const fx = effectOf(id, v, ACCENTS, HIDEABLE);
  switch (fx.kind) {
    // Allow pinned rates (Behavior): shows the page's Output section, the rate pins (main.js listens).
    case "pinallow":
      bus.emit("pinallow", fx.on);
      break;
    case "accent":
      for (const [name, val] of Object.entries(fx.tokens)) document.documentElement.style.setProperty(name, val);
      break;
    // Top of page: the page's top section (main.js paintFill listens).
    case "fill":
      bus.emit("vfill", fx.value);
      break;
    // Bottom bar: the plate's data-bottom picks Setting Switcher | Volume | None (settings.css shows / hides; the body
    // takes whatever height is freed).
    case "bottom":
      /** @type {HTMLElement} */ (document.getElementById("plate")).dataset.bottom = fx.value;
      bus.emit("relayout"); // rail wire, plots re-measure
      break;
    case "hide":
      hideStages(fx.stages, bus);
      break;
    case "style":
      setOptionStyle(fx.value, bus);
      break;
    case "font":
      setFont(fx.family);
      break;
  }
}

/**
 * Hide from signal chain: each listed stage leaves the chain rail (its drawer closes if open); the wire re-routes.
 *
 * @param {{id: string, hidden: boolean}[]} stages
 * @param {Bus} bus
 */
function hideStages(stages, bus) {
  for (const { id: sid, hidden } of stages) {
    // The chain rail, and the Profile builder's rail (the same stages, the profile's own chain).
    /** @type {NodeListOf<HTMLElement>} */
    const homes = document.querySelectorAll(`:is(#rail, #prail) [data-stage="${sid}"]`);
    for (const st of homes) {
      if (hidden && st.classList.contains("open")) st.click();
      st.hidden = hidden;
    }
  }
  bus.emit("relayout");
}

/**
 * Dyslexic font: the body family swaps (the font's stylesheet loads once, on first use).
 *
 * @param {string | null} family  null restores the default
 */
function setFont(family) {
  const root = document.documentElement.style;
  if (family && !document.getElementById("f-atkinson")) {
    document.head.append(
      h("link#f-atkinson", {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap",
      }),
    );
  }
  if (family) root.setProperty("--f-body", family);
  else root.removeProperty("--f-body");
}

/**
 * Logging drawer: v1 LogTail, always shown — the last 50 lines + Copy; read-only, never stages.
 * @param {HTMLElement} host
 * @param {Clock} clock
 */
function logTail(host, clock) {
  const copy = h("button.btn.xs", { type: "button", text: "Copy" });
  const pre = h("pre.logtail", { text: LOG_TAIL.mock.join("\n") });
  host.append(
    h(
      "div.drow.ltrow",
      {},
      h("div.ctl", {}, h("div.fh", {}, h("b", { text: "Live log tail" })), h("div.act", {}, copy)),
      h("div.man", {}, manPara({ text: LOG_TAIL.man })),
    ),
    pre,
  );
  const restore = revertAfter(
    1500,
    () => {
      copy.textContent = "Copy";
    },
    clock,
  );
  copy.addEventListener("click", () => {
    copy.textContent = "Copied";
    restore();
  });
  clock.requestAnimationFrame(() => {
    pre.scrollTop = pre.scrollHeight;
  });
}
