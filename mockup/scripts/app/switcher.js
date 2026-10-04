// Setting Switcher: a slot's ▾ opens its target's list on the running chain; the Output mode target borrows the two slots
// as the PCM | SDM (DSD) switch; the Volume target gives the slots' place to the volume bar.

import { h } from "../lib/shell/dom.js";
import { mountSwitcher } from "../components/shell/switcher.js";
import { FIELDS, CHAIN_NAMES, CATALOG } from "../data/stages/conversion.js";
import { switcherChange } from "../model/shell/app.js";
import { el } from "./markup.js";

/** @typedef {import("./state.js").App} App */
/** @typedef {import("./state.js").SlotFace} SlotFace */
/** @typedef {import("../components/lists/vselect.js").ListName} ListName */

// The targets (#swtarget) the switcher acts on itself.
const TARGETS = { mode: "Output mode", volume: "Volume" };
// Output mode's slot faces (owner copy): the names spelled out, centred; SDM carries its better-known name under it.
const MODES = [
  ["pcm", "Pulse Code Modulation (PCM)", ""],
  ["sdm", "Sigma Delta Modulation (SDM)", "aka DIRECT STREAM DIGITAL (DSD)"],
];
// The picker field a slot's target opens; a target without one (Matrix profile) has no list sheet.
/** @type {Record<string, string>} */
const SLOT_FIELD = { "1x filter": "1x", "Nx filter": "nx", Modulator: "sh" };
/** A picker field's head copy, by field id. @type {Record<string, { label: string, sub: string }>} */
const FIELD_COPY = FIELDS;
/** A chain's band name, by chain. @type {Record<string, string>} */
const BAND = CHAIN_NAMES;

/**
 * A slot's ▾: its picker is the target's list (running chain).
 *
 * @param {App} app
 * @param {HTMLElement} slot
 * @param {string} target
 */
function openSlotList(app, slot, target) {
  const run = app.conversion.running();
  const field = SLOT_FIELD[target];
  if (!field) return;
  const list = field === "sh" ? (run === "sdm" ? "modulators" : "dithers") : /** @type {ListName} */ (run + "Filters");
  const cat = CATALOG[list];
  const f = field === "sh" ? FIELD_COPY[run + "sh"] : FIELD_COPY[field];
  app.lists.open({
    trigger: slot,
    list,
    stage: field === "nx" ? "nx" : "1x",
    chain: run,
    value: el(".l", slot).textContent,
    title: f.label,
    sub: f.sub,
    band: BAND[run],
    /** @param {string} v */
    onPick: (v) => {
      el(".l", slot).textContent = v;
      el(".v", slot).textContent = cat.find((o) => o.v === v)?.label ?? v;
    },
  });
}

/**
 * The Output mode target borrows the slots: their faces are kept, each slot shows its mode.
 *
 * @param {App} app
 * @param {HTMLElement[]} swSlots
 */
function stashSlots(app, swSlots) {
  app.swStash = swSlots.map((s) => ({
    l: el(".l", s).textContent,
    v: el(".v", s).textContent,
    on: s.classList.contains("on"),
  }));
  swSlots.forEach((s, i) => {
    s.classList.add("mode");
    el(".l", s).textContent = "";
    el(".v", s).textContent = MODES[i][1];
    el(".tx", s).append(h("span.aka", { text: MODES[i][2] }));
    el(".spick", s).hidden = true;
  });
  app.swLight();
}

/**
 * Another target gets the slots back: their kept faces return and the slot `lit` goes live.
 *
 * @param {App} app
 * @param {HTMLElement[]} swSlots
 * @param {number} lit
 */
function restoreSlots(app, swSlots, lit) {
  const was = /** @type {SlotFace[]} */ (app.swStash);
  app.swStash = null;
  swSlots.forEach((s, i) => {
    s.classList.remove("mode");
    s.querySelector(".aka")?.remove();
    el(".l", s).textContent = was[i].l;
    el(".v", s).textContent = was[i].v;
    el(".spick", s).hidden = false;
  });
  el(".sbody", swSlots[lit]).click();
}

/**
 * The switcher's target moved.
 *
 * @param {App} app
 * @param {HTMLSelectElement} swSel
 * @param {HTMLElement[]} swSlots
 */
function onTarget(app, swSel, swSlots) {
  const change = switcherChange(swSel.value, app.swStash, TARGETS);
  app.plate.dataset.sw = change.sw;
  app.bus.emit("relayout");
  if (change.step === "stash") stashSlots(app, swSlots);
  else if (change.step === "restore") restoreSlots(app, swSlots, change.lit);
}

/**
 * Wire the Setting Switcher's slots and target; app.swLight is set here.
 *
 * @param {App} app  the shared state (app/state.js)
 */
export function wireSwitcher(app) {
  mountSwitcher(el(".slots"), (slot, target) => openSlotList(app, slot, target));

  // Output mode: the two slots are the two bands, PCM | SDM (DSD) (no list: ▾ hides). A slot going live sets the mode
  // (live); the mode moving elsewhere (band switch, snapshot) lights its slot. Other targets get their slots back.
  const swSel = /** @type {HTMLSelectElement} */ (el("#swtarget"));
  const swSlots = /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".slots .slot")]);
  app.swLight = () => {
    if (swSel.value !== TARGETS.mode) return;
    const i = MODES.findIndex(([m]) => m === app.conversion.state().mode); // a daemon in Auto: no slot moves
    const b = /** @type {HTMLElement | null | undefined} */ (swSlots[i]?.querySelector(".sbody"));
    if (b && b.getAttribute("aria-checked") !== "true") b.click();
  };
  swSlots.forEach((s, i) =>
    el(".sbody", s).addEventListener("click", () => {
      if (swSel.value === TARGETS.mode) app.conversion.setMode(MODES[i][0]);
    }),
  );
  // Volume target: the slots give way to the volume bar (moved into the switcher), the engine-row volume hides.
  el(".switcher").append(el("#vbar"));
  swSel.addEventListener("change", () => onTarget(app, swSel, swSlots));
}
