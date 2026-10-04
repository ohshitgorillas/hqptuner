// Alerts live where they belong (spec: Alerts; homes in data/alerts.js HOMES), never in a strip of their own:
//   - the home blinks: a rail stage's lamp, or a header / engine-row element (brand knob, gear, gauge).
//     Red = crit, amber = warn or advice. The blink overlays the lamp's own state (an unlit HF filter lamp blinks too).
//   - a stage's drawer carries the alert line pinned under its head (glyph, v1's sentence), and the row that fixes it
//     reads in the alert's colour with the glyph before its label.
//   - an alert whose fix lives on the page (the running chain's filter, modulator, ditherer: the drawer drops those rows)
//     sits in that page section's header instead, the line beside the title, over the field that fixes it.
//   - a header element with no drawer opens the alert in a popover on tap (knob, gauge). The gear's alert blinks the Settings rail category too, whose drawer carries the line.
//   - an SDM modulator below its rate floor (no output): every stage after Shaping goes dark (.dead: unlit, no wire tap).
// set(list) repaints everything from scratch; list = [{kind, sev, text, chain?, rows?}] (chain: 'pcm' | 'sdm', whose rows it lights; rows: overrides the
// home's fixing rows, e.g. the filter actually running).

import { h } from "../../lib/shell/dom.js";
import { popover } from "../../lib/shell/popover.js";
import { placeBy } from "../../lib/shell/plate.js";
import { HOMES } from "../../data/shell/alerts.js";
import { alertPlan, alertsAt, noteHomes, worseBlink } from "../../model/shell/alerts.js";

/** @typedef {import('../../model/shell/alerts.js').Sev} Sev */
/** @typedef {import('../../model/shell/alerts.js').Alert} Alert */
/** @typedef {import('../../model/shell/alerts.js').AlertPlan} AlertPlan */
/** @typedef {{plate: HTMLElement, stages: Map<string, HTMLElement>, srail: HTMLElement}} Homes */

/** @type {Record<Sev, string>} */
const GLYPH = { crit: "⚠", warn: "⚠", advice: "♪" };

/**
 * @param {Alert} a
 * @param {string} [tag]
 */
const line = (a, tag = "p") =>
  h(
    `${tag}.aline`,
    { data: { sev: a.sev } },
    h("span.ag", { "aria-hidden": "true", text: GLYPH[a.sev] }),
    h("span", { text: a.text }),
  );

/**
 * Worst severity wins on a shared home.
 *
 * @param {Element | null | undefined} home
 * @param {Sev} sev
 */
function mark(home, sev) {
  if (!home) return;
  const el = /** @type {HTMLElement} */ (home);
  const next = worseBlink(el.dataset.alert, sev);
  if (next !== el.dataset.alert) el.dataset.alert = next;
}

/** @param {HTMLElement} plate */
function clear(plate) {
  for (const el of plate.querySelectorAll("[data-alert]")) el.removeAttribute("data-alert");
  for (const el of plate.querySelectorAll(".dalert, .salert")) el.remove();
  for (const el of plate.querySelectorAll(".st.dead")) el.classList.remove("dead");
  for (const el of plate.querySelectorAll('.gauge[role="button"]')) {
    el.removeAttribute("role");
    el.removeAttribute("tabindex");
  }
}

/**
 * Pin a plan (model/alerts.js alertPlan) on the plate: blink its homes, darken its dead stages, pin its lines.
 *
 * @param {Homes} at
 * @param {AlertPlan} plan
 */
function pin(at, plan) {
  blinkHomes(at, plan);
  pinDrawers(at.plate, plan);
  pinSections(at.plate, plan);
}

/**
 * Blink the plan's homes and darken its dead stages; a blinking gauge takes taps like a button.
 *
 * @param {Homes} at
 * @param {AlertPlan} plan
 */
function blinkHomes({ plate, stages, srail }, plan) {
  for (const [id, b] of plan.blinks.stage) mark(stages.get(id), b);
  for (const [sel, b] of plan.blinks.el) mark(plate.querySelector(sel), b);
  for (const [id, b] of plan.blinks.set) mark(srail.querySelector(`.sst[data-stage="${id}"]`), b);
  for (const id of plan.dark) stages.get(id)?.classList.add("dead");
  if (plan.blinks.el.has(".gauge")) {
    const g = /** @type {HTMLElement} */ (plate.querySelector(".gauge"));
    g.setAttribute("role", "button");
    g.tabIndex = 0;
  }
}

/**
 * Drawer: the alert lines under the head; the fixing rows in the alert's colour.
 *
 * @param {HTMLElement} plate
 * @param {AlertPlan} plan
 */
function pinDrawers(plate, plan) {
  for (const [id, { alerts, rows }] of plan.drawers) {
    const d = plate.querySelector(`#drawer-${id}`);
    if (!d) continue;
    /** @type {Element} */ (d.querySelector(":scope > .dhead")).after(
      h(
        "div.dalert",
        { role: "status" },
        alerts.map((a) => line(a)),
      ),
    );
    for (const row of rows) lightRow(d, row);
  }
}

/**
 * Light the drawer rows labelled as the fixing row is, in the alert's colour.
 *
 * @param {Element} d  the drawer
 * @param {import('../../model/shell/alerts.js').LitRow} row
 */
function lightRow(d, { label, chain, sev }) {
  // chain: a chain alert lights its own chain's rows only (the Resampling · Shaping drawer holds both chains).
  const scope = chain ? `.dpanel[aria-label^="${chain === "sdm" ? "SDM" : "PCM"}"] ` : "";
  for (const b of d.querySelectorAll(`${scope}.drow .ctl > .fh > b`))
    if (b.textContent === label) mark(b.closest(".drow"), sev);
}

/**
 * Page: the section header carries the lines, beside the title (the hairline gives way).
 *
 * @param {HTMLElement} plate
 * @param {AlertPlan} plan
 */
function pinSections(plate, plan) {
  for (const [name, as] of plan.sections) {
    const t = plate.querySelector(`#body > main.page > section[aria-label="${name}"] .sh .t`);
    if (!t) continue;
    t.after(
      h(
        "div.salert",
        { role: "status" },
        as.map((a) => line(a)),
      ),
    );
  }
}

/**
 * Mount the alert painter on the plate: set() raises a list of alerts on their homes, repaint() re-pins them after a
 * home was rebuilt.
 *
 * @param {Homes & {bus: import('../../lib/shell/bus.js').Bus}} o
 * @returns {{set: (next: Alert[]) => void, repaint: () => void}}
 */
export function mountAlerts({ plate, stages, srail, bus }) {
  /** @type {Alert[]} */
  let list = [];

  // Tap popovers for the header homes without a drawer (knob, gauge). The knob's own tap (connection settings) still
  // happens; with an alert up, the alert opens over it.
  /** @type {Map<string, {panel: HTMLElement, pop: ReturnType<typeof popover>}>} */
  const notes = new Map(); // selector → {panel, pop}
  /** @param {string} sel */
  function noteFor(sel) {
    const had = notes.get(sel);
    if (had) return had;
    const trigger = /** @type {HTMLElement} */ (plate.querySelector(sel));
    const panel = h("div.pop.notepop.alnote", { role: "dialog", "aria-label": "Alert" });
    plate.append(panel);
    const pop = popover({
      trigger,
      panel,
      onToggle: (open) => {
        if (!open) return;
        const mine = alertsAt(list, HOMES, sel);
        if (!mine.length) {
          pop.close();
          return;
        }
        panel.replaceChildren(...mine.map((a) => line(a)));
        const { left, top } = placeBy(panel, trigger, { side: 22, foot: 14, at: { x: "start", y: "below", gap: 8 } });
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      },
    });
    const n = { panel, pop };
    notes.set(sel, n);
    return n;
  }
  for (const sel of noteHomes(HOMES)) noteFor(sel);

  function paint() {
    clear(plate);
    pin({ plate, stages, srail }, alertPlan(list, HOMES));
    bus.emit("relayout"); // rail wire: dark stages drop their taps; drawers refit
  }

  // The gauge isn't a button: with an alert up it takes taps and Enter like one.
  /** @type {HTMLElement | null} */ (plate.querySelector(".gauge"))?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && /** @type {HTMLElement} */ (e.currentTarget).dataset.alert) noteFor(".gauge").pop.open();
  });

  return {
    set(next) {
      list = next;
      for (const { pop } of notes.values()) pop.close();
      paint();
    },
    /** Re-pin after something rebuilt a home (a page section re-rendered). */
    repaint: () => paint(),
  };
}
