// Tab registry + navigation. Order: Output, Volume, Resampling, DSP, System
// (2026-07-21 reorg: Loudness lives on Volume, Crossfeed on the ex-Matrix tab,
// which took over the DSP name — the old post-process tab is gone). Bar and
// body render separately so the bar can live inside the sticky chrome wrapper
// (App.js) while the body scrolls beneath it.
import { html } from "../../lib/dom.js";
import { Output } from "./OutputTab.js";
import { Volume } from "./VolumeTab.js";
import { Resampling } from "./ResamplingTab.js";
import { System } from "./SystemTab.js";
import { MatrixTab } from "../MatrixTab.js";
import { activeTab as active } from "../../store/ui.js";

const TABS = [
  ["output", "Output", Output],
  ["volume", "Volume", Volume],
  ["resampling", "Resampling", Resampling],
  ["matrix", "DSP", MatrixTab],
  ["system", "System", System],
];

export function TabBar() {
  return html`
    <nav class="tab-nav">
      ${TABS.map(
        ([id, label]) => html`
          <button class=${active.value === id ? "active" : ""} onClick=${() => (active.value = id)}>${label}</button>
        `,
      )}
    </nav>
  `;
}

export function TabBody() {
  const Body = (TABS.find((t) => t[0] === active.value) || TABS[0])[2];
  return html`<${Body} />`;
}
