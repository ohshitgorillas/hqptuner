// The faceplate's page: one section per engaged stage, in signal order, as model/shell/page.js decides from the running
// path, the running matrix engine and the browser's Top of page and Allow pinned rates preferences. A section is an
// engraved header (title, hairline, then anything the section carries on its header line) over a two-column body,
// and a folded section is its header line alone. Within a section one field is open and every other folds to a line
// that opens it.

import { Fragment } from "preact";
import { html } from "../../lib/dom.js";
import { truthy } from "../../lib/coerce.js";
import { pageSections } from "../../model/shell/page.js";
import { runningValue } from "../../store/resolve.js";
import { playbackPath } from "../../store/faceplate/path.js";
import { topOfPage, allowPinnedRates } from "../../store/ui/faceplate.js";

/** @typedef {import("../../model/shell/page.js").SectionId} SectionId */

/** @type {Record<SectionId, string>} */
const TITLES = {
  source: "Source",
  matrix: "Matrix profile",
  resampling: "Resampling",
  shaping: "Shaping",
  output: "Output",
};

/**
 * One page section.
 *
 * @param {object} props
 * @param {string} props.id  the rail's stage id
 * @param {string} props.title
 * @param {boolean} [props.fill]  takes the spare height
 * @param {boolean} [props.fold]  sits on its header line, no body
 * @param {unknown} [props.head]  what the header line carries after the hairline
 * @param {unknown} [props.children]  the body
 */
export function Section({ id, title, fill = false, fold = false, head, children }) {
  const cls = ["sec", fill ? "fill" : "", fold ? "mxfold" : ""].filter(Boolean).join(" ");
  return html`
    <section class=${cls} data-stage=${id} aria-label=${title}>
      <div class="sh"><span class="t">${title}</span><span class="ln"></span>${head}</div>
      ${!fold && html`<div class="two">${children}</div>`}
    </section>
  `;
}

/** The page: its sections from the running state and the preferences. */
export function Page() {
  const sections = pageSections({
    path: playbackPath(),
    matrixOn: truthy(runningValue("matrix_enabled")),
    topOfPage: topOfPage.value,
    pinsOn: allowPinnedRates.value,
  });
  return html`
    <main class="page">
      ${sections.map(
        (s) => html`<${Section} key=${s.id} id=${s.id} title=${TITLES[s.id]} fill=${s.fill} fold=${s.fold} />`,
      )}
    </main>
  `;
}

/**
 * One field of a section.
 *
 * @typedef {object} Field
 * @property {string} id
 * @property {string} name   what the folded line names it
 * @property {string} why    why it reads as it does, beside the name
 * @property {string} value  its value, at the line's end
 * @property {unknown} body  what it shows open
 */

/**
 * A section's fields: the open one shows its body, every other folds to one line that opens it.
 *
 * @param {object} props
 * @param {Field[]} props.fields
 * @param {string} props.open  the open field's id
 * @param {(id: string) => void} props.onOpen
 */
export function Fields({ fields, open, onOpen }) {
  return fields.map((f) =>
    f.id === open
      ? html`<${Fragment} key=${f.id}>${f.body}<//>`
      : html`
          <button key=${f.id} type="button" class="fline" onClick=${() => onOpen(f.id)}>
            <b>${f.name}</b> ${f.why && html`<span>${f.why}</span>`} <span class="fn">${f.value}</span>
          </button>
        `,
  );
}
