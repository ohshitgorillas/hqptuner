// Setting Switcher: a slot's ▾ opens its target's list on the running chain; the Output mode target borrows the two slots
// as the PCM | SDM (DSD) switch; the Volume target gives the slots' place to the volume bar.

import { $, h } from "../lib/dom.js";
import { mountSwitcher } from "../components/switcher.js";
import { FIELDS, CHAIN_NAMES, CATALOG } from "../data/conversion.js";
import { switcherChange } from "../model/app.js";

// The targets (#swtarget) the switcher acts on itself.
const TARGETS = { mode: "Output mode", volume: "Volume" };
// Output mode's slot faces (owner copy): the names spelled out, centred; SDM carries its better-known name under it.
const MODES = [
  ["pcm", "Pulse Code Modulation (PCM)", ""],
  ["sdm", "Sigma Delta Modulation (SDM)", "aka DIRECT STREAM DIGITAL (DSD)"],
];

/**
 * Wire the Setting Switcher's slots and target; app.swLight is set here.
 *
 * @param {object} app  the shared state (main.js)
 */
export function wireSwitcher(app) {
  const { bus, plate } = app;
  mountSwitcher($(".slots"), (slot, target) => {
    // A slot's ▾: its picker is the target's list (running chain). Matrix profile has no list sheet.
    const run = app.conversion.running();
    const field = { "1x filter": "1x", "Nx filter": "nx", Modulator: "sh" }[target];
    if (!field) return;
    const list = field === "sh" ? (run === "sdm" ? "modulators" : "dithers") : run + "Filters";
    const cat = CATALOG[list];
    const f = field === "sh" ? FIELDS[run + "sh"] : FIELDS[field];
    app.lists.open({
      trigger: slot,
      list,
      stage: field === "nx" ? "nx" : "1x",
      chain: run,
      value: slot.querySelector(".l").textContent,
      title: f.label,
      sub: f.sub,
      band: CHAIN_NAMES[run],
      onPick: (v) => {
        slot.querySelector(".l").textContent = v;
        slot.querySelector(".v").textContent = cat.find((o) => o.v === v)?.label ?? v;
      },
    });
  });

  // Output mode: the two slots are the two bands, PCM | SDM (DSD) (no list: ▾ hides). A slot going live sets the mode
  // (live); the mode moving elsewhere (band switch, snapshot) lights its slot. Other targets get their slots back.
  const swSel = $("#swtarget");
  const swSlots = [...document.querySelectorAll(".slots .slot")];
  app.swLight = () => {
    if (swSel.value !== TARGETS.mode) return;
    const i = MODES.findIndex(([m]) => m === app.conversion.state().mode); // a daemon in Auto: no slot moves
    const b = swSlots[i]?.querySelector(".sbody");
    if (b && b.getAttribute("aria-checked") !== "true") b.click();
  };
  swSlots.forEach((s, i) =>
    s.querySelector(".sbody").addEventListener("click", () => {
      if (swSel.value === TARGETS.mode) app.conversion.setMode(MODES[i][0]);
    }),
  );
  // Volume target: the slots give way to the volume bar (moved into the switcher), the engine-row volume hides.
  $(".switcher").append($("#vbar"));
  swSel.addEventListener("change", () => {
    const change = switcherChange(swSel.value, app.swStash, TARGETS);
    plate.dataset.sw = change.sw;
    bus.emit("relayout");
    if (change.step === "stash") {
      app.swStash = swSlots.map((s) => ({
        l: s.querySelector(".l").textContent,
        v: s.querySelector(".v").textContent,
        on: s.classList.contains("on"),
      }));
      swSlots.forEach((s, i) => {
        s.classList.add("mode");
        s.querySelector(".l").textContent = "";
        s.querySelector(".v").textContent = MODES[i][1];
        s.querySelector(".tx").append(h("span.aka", { text: MODES[i][2] }));
        s.querySelector(".spick").hidden = true;
      });
      app.swLight();
    } else if (change.step === "restore") {
      const was = app.swStash;
      app.swStash = null;
      swSlots.forEach((s, i) => {
        s.classList.remove("mode");
        s.querySelector(".aka")?.remove();
        s.querySelector(".l").textContent = was[i].l;
        s.querySelector(".v").textContent = was[i].v;
        s.querySelector(".spick").hidden = false;
      });
      swSlots[change.lit].querySelector(".sbody").click();
    }
  });
}
