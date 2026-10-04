import { mountBuilder } from "../../../lib/builder/builder.js";
import { NEW } from "../../../../../hqptuner/static/model/builders/builder.js";
import { DEFAULT } from "../../../../../hqptuner/static/model/builders/profile.js";
import { PROFILE_COPY, PB_STEPS, PB_COPY } from "../../../data/builders/profiles.js";
import { show, render } from "../profile-builder.js";
import { dirty, load, skip, answerOf } from "./values.js";
import { scratchOf } from "./records.js";

/** @typedef {import('./records.js').PB} PB */
/** @typedef {import('./records.js').Els} Els */
/** @typedef {import('./records.js').ProfileRecord} ProfileRecord */
/** @typedef {import('./records.js').Buffer} Buffer */
/** @typedef {import('../../../lib/builder/builder.js').Spec<ProfileRecord, Buffer>} Spec */
/** @typedef {import('../../../lib/builder/builder.js').Walk} Walk */

// ── Shell ───────────────────────────────────────────────────────────────
/**
 * Mount the shell over the builder's body: switching, staging, Save / Delete, the rail, the overview's frame.
 *
 * @param {PB} pb
 * @param {Els} el
 */
export function mountShell(pb, { btn, chain, body, rail, settings, snapshot, bus }) {
  const { o, stations, home } = pb;
  /** @type {Spec} */
  const spec = {
    title: "Profile builder",
    closeLabel: "Close Profile builder",
    noun: "Profile",
    stations: stations.map((st) => st.name),
    book: pb.records,
    cur: { st: home, name: NEW },
    copy: copyOf(),
    name: () => pb.meta.name,
    to: () => pb.meta.stations,
    record: () => ({ desc: pb.meta.desc, listen: pb.meta.listen, vals: { ...pb.v } }),
    dirty: () => dirty(pb),
    load: (c, buf) => load(pb, c, buf),
    buffer: () => ({ meta: structuredClone(pb.meta), vals: { ...pb.v } }),
    keeps: (c) => c.name === DEFAULT, // the station's unnamed profile: unticking its station copies it out
    ticked: () => pb.meta.stations.length > 0,
    restarts: () => pb.meta.stations.includes(home), // only the loaded station's profiles can run
    live: () => pb.B.cur.st === home && pb.B.cur.name === o.running(),
    ...after(pb, { settings, snapshot }),
    walk: walkSpec(pb, rail),
  };
  return mountBuilder({ btn, chain, body, bus }, spec);
}

/** @returns {Spec['copy']} the confirm lines, the refusal and the state line */
const copyOf = () => ({
  remove: (/** @type {string} */ n) => PROFILE_COPY.remove(n),
  overwrite: (/** @type {string} */ n) => PROFILE_COPY.overwrite(n),
  noName: PROFILE_COPY.noName,
  state: {
    restarts: PB_COPY.state.dirtyRun,
    dirty: PB_COPY.state.dirty,
    live: PB_COPY.state.running,
    saved: PB_COPY.state.saved,
  },
});

/**
 * What the shell calls after it acts: repaints, the saved and removed hand-offs, leaving and opening.
 *
 * @param {PB} pb
 * @param {Pick<Els, 'settings' | 'snapshot'>} el
 * @returns {Pick<Spec, 'view' | 'refuse' | 'saved' | 'removed' | 'leave' | 'opened' | 'painted'>}
 */
function after(pb, { settings, snapshot }) {
  const { o, home } = pb;
  const reload = () => {
    pb.B.load(pb.B.cur, undefined);
    show(pb, "overview");
    render(pb);
  };
  return {
    view: (where) => {
      if (where) show(pb, where === "here" ? pb.at : "overview");
      render(pb);
    },
    refuse: () => {
      if (pb.at !== "overview") show(pb, "overview");
      pb.B.paintState();
      pb.nameBox.focus();
    },
    saved: ({ name, to, rec }) => {
      pb.B.load(pb.B.cur, undefined);
      show(pb, "overview");
      render(pb);
      // Saving restarts the engine; with the loaded station written, the profile runs (main.js).
      o.onSaved?.(
        to.map((st) => /** @type {[string, string[]]} */ ([st, Object.keys(pb.B.book[st])])),
        rec,
        name,
        to.includes(home),
      );
      pb.B.paintState();
    },
    removed: () => {
      reload();
      o.onSaved?.([[pb.B.cur.st, Object.keys(pb.B.book[pb.B.cur.st])]]);
    },
    leave: () => {
      settings.setOn(false);
      snapshot()?.setOn(false, false);
    },
    opened: () => {
      // What's loaded may have moved since (a chain tweak): an untouched New profile follows it.
      if (pb.B.cur.name === NEW && !pb.B.staged.has(NEW) && !dirty(pb)) pb.B.load(pb.B.cur, undefined);
      show(pb, "overview");
      render(pb);
    },
    painted: (d) => {
      const opt0 = pb.B.pick.selectedOptions[0];
      if (opt0) opt0.textContent = (pb.B.cur.name === NEW ? "New profile" : pb.B.cur.name) + (d ? " •" : "");
    },
  };
}

/**
 * The walk: its steps, their answers, Start from scratch and the name box.
 *
 * @param {PB} pb
 * @param {HTMLElement} rail
 * @returns {Walk}
 */
function walkSpec(pb, rail) {
  return {
    rail,
    steps: PB_STEPS,
    copy: PB_COPY,
    skipOf: (id) => skip(pb, id),
    answer: (id) => (skip(pb, id) ? PB_COPY.skipped : answerOf(pb, id)),
    at: () => pb.at,
    show: (id) => show(pb, id),
    newLabel: "New profile",
    scratch: () => {
      pb.B.load(pb.B.cur, { meta: structuredClone(pb.meta), vals: scratchOf(pb) });
      show(pb, PB_STEPS[0].id);
      render(pb);
    },
    nameBox: {
      type: "text",
      "aria-label": "Profile name",
      maxlength: 60,
      spellcheck: "false",
      placeholder: PROFILE_COPY.name,
    },
    setName: (n) => {
      pb.meta.name = n;
    },
  };
}
