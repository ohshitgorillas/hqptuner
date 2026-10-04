// Profile builder: the page's `Profile builder` button (Matrix engine section) swaps the chain body for this one, as the
// gear does for Settings. Header, engine row and bottom bar stay. It covers the entire process of
// building a matrix profile, pipelines included; it edits a copy (nothing reaches the engine until
// Save, and saving restarts the engine), × on its title; it guides the user (even an expert on what they want isn't one
// on how HQPTuner lays it out), coherent and cohesive, no parts bin.
//   Rail   the walk, in the chain rail's grammar: Overview, then Listening, EQ / Correction, Crossfeed, DAC correction,
//          Loudness, each with its answer (`Skipped` where it doesn't apply). The page showing is lit (amber name +
//          left-hand bar). Tap any to jump: nothing forces the order.
//   Overview  the intro beside the signal chain with its part lit; what the profile holds,
//          one line per part (› jumps to its step) and DSP pipelines with its own access point (the one drawer); then
//          which profile (picker · Name, full width · Stations), its Description, and the ways on: Save (done, for a
//          profile tuned by ear already), Change something (the walk from here), Start from scratch (the walk from
//          defaults). Advanced settings: a quiet link at the foot only.
//   Steps  one part at a time in the drawers' row grammar (control column | the manual's own paragraph; choices as the
//          Volume drawer's choice lines), a guidance line on what the step decides, Back / Next; a step that doesn't apply
//          says why and Next passes it. The last step's Next (`Review`) returns to the overview.
// Edits stay staged per profile until Save or Discard, through switching and leaving. `[Default]` keeps its name and
// can't be deleted (v1). The builder opens on New profile from the running matrix (what's loaded: save it as it is).
// Save writes, restarts and runs the profile when the loaded station is ticked; the builder stays on it.
// Exit: ×, Escape with nothing open, the gear (Settings), or the Snapshot builder button.
// The shell (switching, staging, Save / Delete, the rail, the overview's frame, the swap) is lib/builder.js.
// Its decisions (skips, answers, dirty, layout, picker) are model/profile.js; this file builds and paints.

import { h } from "../../lib/shell/dom.js";
import { closeOthers } from "../drawers/drawer.js";
import { select } from "../controls/seg.js";
import { NEW } from "../../../../hqptuner/static/model/builders/builder.js";
import {
  holdSkipped,
  shapeOf,
  needsLayout,
  paintView,
  pickerOf,
  renderView,
} from "../../../../hqptuner/static/model/builders/profile.js";
import { CROSSFEED } from "../../data/stages/matrix.js";
import { PB_COPY } from "../../data/builders/profiles.js";
import { tablesOf } from "./profile-builder/records.js";
import { mountShell } from "./profile-builder/shell.js";
import { mountValues, dirty, skip, answerOf } from "./profile-builder/values.js";
import { mountOverview } from "./profile-builder/overview.js";
import { mountSteps, stepPage } from "./profile-builder/steps.js";
import { mountAdvanced, advancedPage } from "./profile-builder/advanced.js";

/** @typedef {import('./profile-builder/records.js').PB} PB */
/** @typedef {import('./profile-builder/records.js').Els} Els */
/** @typedef {import('./profile-builder/records.js').Station} Station */
/** @typedef {import('./profile-builder/records.js').ProfileSource} ProfileSource */
/** @typedef {import('./profile-builder/records.js').Opts} Opts */

/**
 * Mount the Profile builder on its body; it opens on New profile from what's loaded.
 *
 * @param {Els} el  btn: the page's button, chain: #body, body: #pbody, rail, page, plate, settings, snapshot, bus
 * @param {Station[]} stations  in the tree's order
 * @param {Record<string, Record<string, ProfileSource>>} data  PROFILES: station → name → {desc, listen?, vals?, pipes?}
 * @param {Opts} o  pipelines: the page's pipeline set (data/pipelines.js pipelineSet), shared with the chain
 */
export function mountProfileBuilder(el, stations, data, o) {
  // pb: the builder's tables, its edit state ({meta, known, ready, at, shape}) and its parts, shared by the functions below.
  const pb = tablesOf(stations, data, o, el.page);
  pb.B = mountShell(pb, el);
  pb.pick = pb.B.pick;
  pb.nameBox = /** @type {HTMLInputElement} */ (pb.B.nameBox);
  mountValues(pb, el);
  mountOverview(pb);
  mountSteps(pb);
  mountAdvanced(pb);
  o.levelBus.addEventListener("level", () => {
    if (pb.ready && !el.body.hidden) paint(pb);
  });

  pb.B.load(pb.B.cur, undefined);
  pb.ready = true;
  show(pb, "overview");
  render(pb);
  return pb.B.start();
}

/**
 * What the showing step lays out now.
 *
 * @param {PB} pb
 * @returns {string}
 */
const shapeNow = (pb) => shapeOf({ at: pb.at, meta: pb.meta, vals: pb.v, known: pb.known, skip: skip(pb, pb.at) });
/**
 * Show page `id`: the overview, Advanced settings, or a step of the walk (anything else: the overview).
 *
 * @param {PB} pb
 * @param {string} id
 */
export function show(pb, id) {
  if (!pb.B.inWalk(id) && id !== "advanced") id = "overview";
  closeOthers(null);
  pb.at = id;
  pb.page.replaceChildren(id === "overview" ? pb.overview : id === "advanced" ? advancedPage(pb) : stepPage(pb, id));
  pb.shape = shapeNow(pb);
  if (pb.ready) {
    paint(pb);
    pb.B.paintState();
  }
}

// ── Paint ───────────────────────────────────────────────────────────────
/**
 * Paint every control from the values, the answers, the pipelines count and the rail; re-lay out a step whose shape moved.
 *
 * @param {PB} pb
 */
export function paint(pb) {
  if (needsLayout(pb.at, pb.shape, shapeNow(pb))) {
    show(pb, pb.at);
    return;
  }
  const { v } = pb;
  const view = paintView(v, CROSSFEED.sPresets);
  select(pb.listenSeg, pb.meta.listen);
  pb.eq.paint();
  pb.xfSel.paint(v.xfmode !== "off");
  pb.xfKnown.paint();
  select(pb.bPre, v.xfpreset);
  select(pb.sPre, view.structural);
  for (const n of [...pb.bNums, ...pb.sNums, ...pb.ldNums]) n.paint();
  select(pb.dcSeg, v.dcen);
  pb.dcSel.value = v.dcdac;
  pb.dcSel.disabled = !view.dacModel;
  pb.dcSel.classList.toggle("grayed", !view.dacModel);
  select(pb.ldSeg, v.ldon);
  pb.ldKnown.paint();
  select(pb.engSeg, v.mxengine);
  select(pb.hfSeg, v.mxexpand);
  select(pb.iirSeg, v.mxiir2fir);
  pb.engList.paint();
  pb.iirList.paint();
  for (const r of pb.holdRows)
    r.a.textContent = holdSkipped(r.id, skip(pb, r.id), v) ? PB_COPY.skipped : answerOf(pb, r.id);
  pb.plCount.textContent = `${pb.plCore.count()} active`;
  pb.B.paintRail();
}

/**
 * Render the record showing: the picker, name, description, Delete, the confirm line, the Stations menu, then paint.
 *
 * @param {PB} pb
 */
export function render(pb) {
  const { B, pick, nameBox, meta } = pb;
  const { cur } = B;
  const view = renderView(cur, B.staged.has(NEW), dirty(pb));
  pick.replaceChildren(
    ...pickerOf(
      pb.stations.map((st) => st.name),
      B.book,
      (c) => B.isDirty(c),
    ).map((g) =>
      h(
        "optgroup",
        { label: g.st },
        g.options.map((x) => h("option", { value: x.key, text: x.dirty ? `${x.name} •` : x.name })),
      ),
    ),
    h("option", { value: NEW, text: view.newDirty ? "New profile •" : "New profile" }),
  );
  pick.value = B.K(cur);
  nameBox.value = meta.name;
  nameBox.readOnly = view.fixedName; // the station's unnamed profile: the daemon's name, not one to change (v1)
  pb.desc.value = meta.desc;
  pb.acts.del.hidden = !view.deletable;
  pb.askHost.replaceChildren(...(B.ask ? [B.askLine()] : []));
  pb.stMenu.paint();
  paint(pb);
  B.paintState();
}
