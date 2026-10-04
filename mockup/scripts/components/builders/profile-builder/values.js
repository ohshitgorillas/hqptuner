import { h } from "../../../lib/shell/dom.js";
import { mountDrawer, familyOf } from "../../drawers/drawer.js";
import { createPipelines } from "../../drawers/pipelines.js";
import { holdRow } from "../../../lib/builder/builder.js";
import { NEW } from "../../../model/builders/builder.js";
import { modeName } from "../../../../../hqptuner/static/model/gauges/crossfeed.js";
import { stepContext, skipOf, knownOf, isDirty, summaryOf } from "../../../model/builders/profile.js";
import { XF_MODES } from "../../../data/stages/matrix.js";
import { PB_STEPS, LISTEN } from "../../../data/builders/profiles.js";
import { show, paint } from "../profile-builder.js";
import { asProfile, listenOf } from "./records.js";

/** @typedef {import('./records.js').PB} PB */
/** @typedef {import('./records.js').Ref} Ref */
/** @typedef {import('./records.js').Vals} Vals */
/** @typedef {import('./records.js').Meta} Meta */
/** @typedef {import('../../../model/builders/profile.js').Summary} Summary */
/** @typedef {import('../../../model/builders/profile.js').StepContext} StepContext */
/** @typedef {{ meta: Meta, vals: Vals }} Buffer  an edit: what it holds, as staged or as saved */

const FAM = "pbuild";

// ── Values: one family store (the DSP pipelines drawer is its one drawer member) ─────
/**
 * Mount the family store and its one drawer member, the DSP pipelines drawer.
 *
 * @param {PB} pb
 * @param {{ body: HTMLElement, plate: HTMLElement }} el
 */
export function mountValues(pb, { body, plate }) {
  const { PIPELINES, PIPELINES_DRAWER, FULL_FITS } = pb.o.pipelines;
  const pl0 = holdRow("DSP pipelines", null, "button.pbhold.pbpl");
  pb.plBtn = /** @type {HTMLButtonElement} */ (pl0.el);
  pb.plCount = pl0.a;
  pb.plCore = createPipelines(PIPELINES, {
    bypassed: () => "",
    plate,
    openCrossfeed: () => {
      pb.pl.setOpen(false);
      show(pb, "crossfeed");
    },
    goTab: (id) => pb.pl.showTab(id),
  });
  pb.pl = mountDrawer(body, pb.plBtn, PIPELINES_DRAWER, {
    prefix: "pb-",
    family: FAM,
    head: h("div.apply.pbact", {}, pb.B.discardButton()),
    onValues: () => {
      if (pb.ready) {
        paint(pb);
        pb.B.paintState();
      }
    },
    blocks: Object.fromEntries([
      ["pl-overview", pb.plCore.overview],
      ...Array.from({ length: PIPELINES.outputs }, (_, k) => [`pl-out${k}`, pb.plCore.output(k)]),
    ]),
  });
  pb.pl.setOpen(false);
  if (!FULL_FITS) /** @type {HTMLElement} */ (body.querySelector("#pb-drawer-pipelines")).classList.add("pl-short");
  pb.fam = familyOf(FAM);
  pb.v = pb.fam.vals;
}

/**
 * Set values from the page: stages them (the pipelines member re-reads, so crossfeed blocks follow), repaints.
 *
 * @param {PB} pb
 * @param {Vals} patch
 */
export function set(pb, patch) {
  for (const [k, x] of Object.entries(patch)) pb.v[k] = String(x);
  pb.pl.regray();
}

/**
 * What record `c` holds as saved (New: what's loaded, in the loaded station).
 *
 * @param {PB} pb
 * @param {Ref} c
 * @returns {Buffer}
 */
function savedOf(pb, c) {
  if (c.name === NEW)
    return {
      meta: { name: "", stations: [pb.home], desc: "", listen: listenOf(pb.applied) },
      vals: asProfile(pb.applied),
    };
  const r = pb.B.book[c.st][c.name];
  return { meta: { name: c.name, stations: [c.st], desc: r.desc, listen: r.listen }, vals: r.vals };
}

/**
 * The edit differs from what its record holds as saved.
 *
 * @param {PB} pb
 * @returns {boolean}
 */
export const dirty = (pb) => isDirty(pb.v, pb.meta, savedOf(pb, pb.B.cur));

/**
 * Load record `c`'s edit: its staged buffer when given, else the record as saved.
 *
 * @param {PB} pb
 * @param {Ref} c
 * @param {Buffer} [buf]
 */
export function load(pb, c, buf) {
  const s0 = savedOf(pb, c);
  const to = buf ? buf.vals : s0.vals;
  Object.assign(pb.v, to);
  Object.assign(pb.fam.base, to);
  pb.pl.discarded();
  pb.pl.settle(); // the pipelines block repaints from the values (crossfeed blocks rebuilt)
  if (buf) {
    Object.assign(pb.fam.base, s0.vals);
    pb.pl.remark();
  }
  pb.meta = structuredClone(buf?.meta ?? s0.meta);
  pb.known = knownOf(pb.v, pb.presets, pb.LD);
  if (pb.ready) pb.eq.reset();
}

// ── Rail: the walk's answers ────────────────────────────────────────────
/**
 * What a step's guide and skip read.
 *
 * @param {PB} pb
 * @returns {StepContext}
 */
export const ctx = (pb) => stepContext(pb.meta.listen, pb.o.fixed(), pb.MODELS);
/**
 * Why step `id` doesn't apply ('' = it does).
 *
 * @param {PB} pb
 * @param {string} id
 * @returns {string}
 */
export const skip = (pb, id) => skipOf(PB_STEPS, id, ctx(pb));
/**
 * Each step's answer from the profile's summary (EQ answers for itself).
 *
 * @type {Record<string, (x: Summary) => string>}
 */
const ANSWER = {
  listen: (x) => /** @type {string} */ (LISTEN.find((l) => l.v === x.listen)?.label),
  crossfeed: ({ crossfeed: x }) => (x.on ? `${modeName(XF_MODES, x.mode) ?? "Off"} · ${x.preset ?? "Custom"}` : "Off"),
  correction: ({ correction: x }) => (x.on ? x.model || "[none]" : "Bypassed"),
  loudness: ({ loudness: x }) => (x.on ? `${x.percent}% applied` : "Off"),
};
/**
 * Step `id`'s answer on the rail and the overview.
 *
 * @param {PB} pb
 * @param {string} id
 * @returns {string}
 */
export function answerOf(pb, id) {
  if (id === "eq") return pb.eq.answer();
  return ANSWER[id](summaryOf(pb.meta, pb.v, pb.presets, { level: pb.o.level(), fixed: pb.o.fixed() }));
}
