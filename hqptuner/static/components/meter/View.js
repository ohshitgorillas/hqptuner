// The METER page. A mode like LIVE, opened from the header's mini spectrum; the
// page holds nothing yet.
import { html } from "../../lib/dom.js";

/** The METER page's root section. */
export function MeterView() {
  return html`<section class="tab-body" data-testid="meter-page"></section>`;
}
