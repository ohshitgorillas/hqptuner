// Page conversion, what runs and where it shows: the running chain and the scenario path, the rail's DSD Processing,
// Resampling, Shaping and Output values, and the fit that keeps every section on the plate (components/page/conversion.js).

import { optCopy, fitCopy } from "../../lists/vselect.js";
import { CHAIN_LISTS, runningChain } from "../../../data/stages/conversion.js";
import { pathOf } from "../../../data/shell/scenarios.js";
import { scale } from "../../../lib/shell/plate.js";
import { FIT_PASSES, fitStep, overrunOf, overruns, railValues } from "../../../model/shell/conversion.js";

/** @typedef {import('../conversion.js').ConvState} ConvState */
/** @typedef {import('../conversion.js').ConvHosts} ConvHosts */
/** @typedef {import('../../lists/vselect.js').CatalogOption} CatalogOption */

/** @type {Record<string, { filters: CatalogOption[], shapers: CatalogOption[] }>} */
const LISTS_BY_CHAIN = CHAIN_LISTS;

/**
 * The chain the source plays through.
 *
 * @param {ConvState} st
 */
export const running = (st) => runningChain(st.mode, { playing: st.scene.playing, family: st.scene.family });
/**
 * The scenario's path through the engine.
 *
 * @param {ConvState} st
 */
export const path = (st) => pathOf(st.scene, running(st), st.direct);
/**
 * What plays: the running chain, the scenario path, the filter stage the source rate selects.
 *
 * @param {ConvState} st
 */
export const playOf = (st) => ({ run: running(st), path: path(st), stage: /** @type {string} */ (st.scene.stage) });
/**
 * The catalog a chain's field picks from: its shapers for `sh`, else its filters.
 *
 * @param {string} ch
 * @param {string} k
 */
export const listOf = (ch, k) => (k === "sh" ? LISTS_BY_CHAIN[ch].shapers : LISTS_BY_CHAIN[ch].filters);
/**
 * A rail stage's button.
 *
 * @param {ConvHosts} hosts
 * @param {string} id
 */
const stageOf = (hosts, id) => /** @type {HTMLElement} */ (hosts.stages.get(id));
/**
 * A part of a rail stage's button: its name (`.n`) or its value (`.v`).
 *
 * @param {ConvHosts} hosts
 * @param {string} id
 * @param {string} sel
 */
const stagePart = (hosts, id, sel) => /** @type {HTMLElement} */ (stageOf(hosts, id).querySelector(sel));

/**
 * Keep every section on the plate: while the page's last section runs past its bottom, the tallest open copy gives up
 * the overrun (its prose cut short, `… see more` opens it whole). Matrix engine's plot is the stretch and has its
 * 150px floor, so in PCM a long option line is what would push Output off.
 *
 * @param {ConvState} st
 */
export function fit(st) {
  const page = st.hosts.rs.closest("main");
  if (!page || !page.offsetParent) return;
  const k = scale();
  const overrun = () => {
    const kids = /** @type {HTMLElement[]} */ ([...page.children]).filter((c) => c.offsetParent);
    return overrunOf({
      bottoms: kids.map((c) => c.getBoundingClientRect().bottom),
      pageBottom: page.getBoundingClientRect().bottom,
      scale: k,
      padding: parseFloat(getComputedStyle(page).paddingBottom),
    });
  };
  for (const c of st.copies) c.host.replaceChildren(...optCopy(listOf(c.ch, c.k), st.vals[c.ch + c.k]).filter(Boolean));
  /** @param {{ host: HTMLElement }} c */
  const measure = (c) => ({
    height: c.host.offsetHeight,
    left: /** @type {HTMLElement} */ (c.host.previousElementSibling).offsetHeight,
  });
  for (let i = 0; i < FIT_PASSES && overruns(overrun()); i++) {
    const step = fitStep(st.copies.map(measure), overrun());
    if (!step) break;
    const c = st.copies[step.index];
    fitCopy(c.host, listOf(c.ch, c.k), st.vals[c.ch + c.k], step.height);
  }
}

/**
 * A stage name that wraps (the DSD conversion stage) puts its lamp on the first line; re-measured once fonts land.
 *
 * @param {ConvHosts} hosts
 */
export function wraps(hosts) {
  for (const id of ["dsd", "resampling", "shaping"]) {
    const n = stagePart(hosts, id, ".n");
    /** @type {HTMLElement} */ (n.parentElement).classList.toggle("wrap", n.offsetHeight > 30);
  }
}

/**
 * The rail's values for what plays, the Output readouts, and the path reported out when it changes.
 *
 * @param {ConvState} st
 */
export function rail(st) {
  const { hosts } = st;
  const play = playOf(st),
    { run, path: p } = play;
  const r = railValues(play, st.direct, st.vals);
  // DSD Processing: always on the rail (hideable); in this track's path only on a processed DSD source.
  const dsd = stageOf(hosts, "dsd");
  dsd.classList.toggle("byp", !r.dsdInPath);
  stagePart(hosts, "dsd", ".v").textContent = r.dsd;
  // Direct: Resampling and Shaping aren't in the path, so they leave the chain while it plays.
  let moved = false;
  for (const id of ["resampling", "shaping"]) {
    const stage = stageOf(hosts, id);
    if (stage.hidden !== r.offChain) {
      stage.hidden = r.offChain;
      moved = true;
    }
  }
  const rn = stagePart(hosts, "resampling", ".n"),
    name = r.rateConversion ? "Rate conversion" : "Resampling";
  if (rn.textContent !== name) {
    rn.textContent = name;
    moved = true;
  }
  if (moved) hosts.bus.emit("relayout"); // rail wire redraws
  stagePart(hosts, "resampling", ".v").textContent = r.resampling;
  stagePart(hosts, "shaping", ".v").textContent = r.shaping;
  wraps(hosts);
  const o = st.out(run, p, st.scene);
  hosts.onOut?.({ mode: st.mode, run, tier: o.tier, rate: o.rate, rest: o.rest }); // the page's Output tuner
  hosts.onRun?.(run);
  stagePart(hosts, "output", ".v").textContent = o.value;
  const key = `${st.scene.id}|${p}|${run}`;
  if (key !== st.reported) {
    st.reported = key;
    hosts.onPath?.(p, run, st.scene);
  }
}
