// The faceplate's page: one section per engaged stage, in signal order, as model/shell/page.js decides from the running
// path, the running matrix engine and the browser's Top of page and Allow pinned rates preferences. A section is an
// engraved header (title, hairline, then anything the section carries on its header line) over a body, two columns
// unless the section's instrument fills it whole, and a folded section is its header line alone. Source holds the
// page meter with Display on its header, Matrix profile the profile select, its description and its response plot,
// Resampling and Shaping the running chain's pickers with Filter presets on Resampling's header, and Output the rate
// pins.

import { html } from "../../lib/dom.js";
import { truthy } from "../../lib/coerce.js";
import { classNames } from "../../model/shell/format.js";
import { pageSections } from "../../model/shell/page.js";
import { runningValue } from "../../store/resolve.js";
import { playbackPath } from "../../store/faceplate/path.js";
import { pageMeter } from "../../store/faceplate/page/meter.js";
import { conversionSections } from "../../store/faceplate/page/conversion.js";
import { topOfPage, allowPinnedRates } from "../../store/ui/faceplate.js";
import { alertsNow } from "../../store/faceplate/alerts.js";
import { AlertLines } from "./AlertLines.js";
import { SourceMeter } from "./page/SourceMeter.js";
import { MatrixProfileBody, ProfileLine } from "./page/MatrixProfile.js";
import { Conversion } from "./page/Conversion.js";
import { DisplayButton } from "./page/DisplayOptions.js";
import { FilterPresetsButton } from "./page/FilterPresets.js";
import { OutputPins } from "./page/OutputPins.js";

/** @typedef {import("../../model/shell/page.js").SectionId} SectionId */
/** @typedef {import("../../model/shell/page.js").PageSection} PageSection */

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
 * @param {string} [props.cls]  classes beside `sec`
 * @param {string} [props.bodyCls]  classes beside `two` on the body
 * @param {boolean} [props.two]  the body is two columns; false puts the children straight in the section
 * @param {unknown} [props.head]  what the header line carries after the hairline
 * @param {unknown} [props.children]  the body
 */
export function Section({ id, title, fill = false, fold = false, cls, bodyCls, two = true, head, children }) {
  const body = two ? html`<div class=${classNames("two", bodyCls)}>${children}</div>` : children;
  const alerts = alertsNow.value.sections.get(id);
  return html`
    <section class=${classNames("sec", fill && "fill", fold && "mxfold", cls)} data-stage=${id} aria-label=${title}>
      <div class="sh">
        <span class="t">${title}</span>
        ${alerts?.length ? html`<div class="salert" role="status"><${AlertLines} alerts=${alerts} /></div>` : null}
        <span class="ln"></span>${head}
      </div>
      ${!fold && body}
    </section>
  `;
}

/**
 * What each section draws: its header contents, its body and the classes its body or itself carries.
 *
 * @type {Record<SectionId, (s: PageSection) => Record<string, unknown>>}
 */
const BODIES = {
  source: () => ({
    cls: classNames("psrc", pageMeter().slim && "slim"),
    head: html`<${DisplayButton} />`,
    two: false,
    children: html`<${SourceMeter} />`,
  }),
  matrix: (s) => ({
    head: s.fold ? html`<${ProfileLine} />` : null,
    bodyCls: "stretch",
    children: html`<${MatrixProfileBody} />`,
  }),
  resampling: () => ({
    head: html`<${FilterPresetsButton} />`,
    bodyCls: conversionSections().resampling.open.length > 1 ? "both" : undefined,
    children: html`<${Conversion} section="resampling" />`,
  }),
  shaping: () => ({ children: html`<${Conversion} section="shaping" />` }),
  output: () => ({ two: false, children: html`<${OutputPins} />` }),
};

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
        (s) =>
          html`<${Section} key=${s.id} id=${s.id} title=${TITLES[s.id]} fill=${s.fill} fold=${s.fold} ...${BODIES[s.id](s)} />`,
      )}
    </main>
  `;
}
