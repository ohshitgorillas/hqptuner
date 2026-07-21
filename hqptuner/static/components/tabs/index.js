// Tab registry + navigation. Order: Output, Volume, Resampling, DSP, Matrix,
// System. Bar and body render separately so the bar can live inside the sticky
// chrome wrapper (App.js) while the body scrolls beneath it.
import { signal } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Output } from "./OutputTab.js";
import { Volume } from "./VolumeTab.js";
import { Resampling } from "./ResamplingTab.js";
import { Dsp } from "./DspTab.js";
import { System } from "./SystemTab.js";
import { MatrixTab } from "../MatrixTab.js";

const active = signal("output");

const TABS = [
  ["output", "Output", Output],
  ["volume", "Volume", Volume],
  ["resampling", "Resampling", Resampling],
  ["dsp", "DSP", Dsp],
  ["matrix", "Matrix", MatrixTab],
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
