// The Profile builder's body: the rail, the hairline, the page showing, and the DSP pipelines drawer over the page. The
// rail lists the overview, then each step with its answer, Skipped where it does not apply. The page is the overview
// (./ProfileOverview.js's), a step's page, or Advanced settings. The body opens on the loaded station's New entry.

import { useState } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { OVERVIEW, shownName } from "../../../model/builders/builder.js";
import { PB_COPY, PB_STEPS } from "../../../store/faceplate/builders/profile-data.js";
import { page, meta, openProfileBuilder, skip, answerOf } from "../../../store/faceplate/builders/profile.js";
import { cur } from "../../../store/faceplate/builders/shell.js";
import { stageDrawer } from "../drawers/index.js";
import { Drawer } from "../drawer/Drawer.js";
import { StepPage, AdvancedPage } from "./ProfileSteps.js";
import { TITLE, NOUN, NEW_LABEL, show, pipelinesStage, ProfileOverview } from "./ProfileOverview.js";

/** The rail's entries' ids: the overview, then every step. */
const RAIL_IDS = [OVERVIEW, ...PB_STEPS.map((s) => s.id)];

/**
 * A step's answer, or Skipped where it does not apply.
 *
 * @param {string} id
 */
const answerShown = (id) => (skip(id) ? PB_COPY.skipped : answerOf(id));

/**
 * One rail entry: its title and reading, lit while its page shows (the overview for a page off the rail).
 *
 * @param {{ id: string, title: string, value: string }} props
 */
function Entry({ id, title, value }) {
  const at = page.value;
  const open = id === at || (id === OVERVIEW && !RAIL_IDS.includes(at));
  const skipped = id !== OVERVIEW && !!skip(id);
  return html`
    <button
      type="button"
      class=${["st", open ? "open" : "", skipped ? "skip" : ""].filter(Boolean).join(" ")}
      data-stage=${id}
      aria-current=${String(id === at)}
      onClick=${() => show(id)}
    >
      <span class="n">${title}</span>
      <span class="v">${value}</span>
    </button>
  `;
}

/**
 * The Profile builder's rail: the overview reading the shown name, then each step reading its answer.
 */
export function ProfileRail() {
  const name = shownName(meta.value.name, cur.value) || NEW_LABEL;
  return html`
    <nav class="rail prail" aria-label=${TITLE}>
      <${Entry} id=${OVERVIEW} title=${PB_COPY.overview} value=${name} />
      ${PB_STEPS.map((s) => html`<${Entry} key=${s.id} id=${s.id} title=${s.title} value=${answerShown(s.id)} />`)}
    </nav>
  `;
}

/** The page showing: the overview, Advanced settings, or a step's page. */
function shownPage() {
  const at = page.value;
  if (at === OVERVIEW) return html`<${ProfileOverview} />`;
  if (at === "advanced") return html`<${AdvancedPage} />`;
  return html`<${StepPage} id=${at} />`;
}

/** Open on the loaded station's New entry, once per mount; runs during the first render. */
function openOnce() {
  openProfileBuilder();
  return true;
}

/**
 * The Profile builder's body: rail, hairline, page, and the DSP pipelines drawer.
 */
export function ProfileBuilder() {
  useState(openOnce);
  const { schema, blocks } = stageDrawer(pipelinesStage());
  return html`
    <div class="body" data-body="profile">
      <${ProfileRail} />
      <div class="vrule"></div>
      <main class="page pbpage" aria-label=${NOUN}>${shownPage()}</main>
      <${Drawer} schema=${schema} blocks=${blocks} />
    </div>
  `;
}
