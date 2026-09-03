// The filter primer's graph: three SVG panes and the controls beneath, all
// drawn from store/primergraph.js (docs/plans/filter-primer-graph.md). Impulse
// and Delay half width on the top row, Frequency full width beneath; the
// panes stack in that order on a narrow viewport (css/features/primer.css).
//
// `PlotFrame` (../plots.js) is unusable here, its axis is log 20 Hz to 20 kHz;
// the plot classes and the depth ladder in cards/plots.css are reused. Every
// curve is textbook FIR design computed in the browser, no HQPlayer filter is
// plotted, named or approximated.
import { html } from "../../lib/dom.js";
import { PrimerControls } from "./Controls.js";
import { DelayPane } from "./DelayPane.js";
import { FrequencyPane } from "./FrequencyPane.js";
import { ImpulsePane } from "./ImpulsePane.js";

/** The primer graph: the three panes, the controls beneath. */
export function PrimerGraph() {
  return html`
    <div class="primer-graph">
      <div class="primer-panes">
        <${ImpulsePane} />
        <${DelayPane} />
        <${FrequencyPane} />
      </div>
      <${PrimerControls} />
    </div>
  `;
}
