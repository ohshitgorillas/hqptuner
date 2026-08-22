// Tab registry + navigation. Order: Output, Volume, Matrix, System
// (Conversion lives on Output, Loudness on Volume, Crossfeed on Matrix). Bar
// and body render separately so the bar can live inside the sticky chrome
// wrapper (App.js) while the body scrolls beneath it.
import { html } from "../../lib/dom.js";
import { Output } from "./OutputTab.js";
import { Volume } from "./VolumeTab.js";
import { System } from "./SystemTab.js";
import { MatrixTab } from "../matrix/Tab.js";
import { activeTab as active } from "../../store/ui.js";
import { dirtyTabs } from "../../store/tabmap.js";

const TABS = [
  ["output", "Output", Output],
  ["volume", "Volume", Volume],
  ["matrix", "Matrix", MatrixTab],
  ["system", "System", System],
];

/** Tab bar: one button per registered tab, flagging the active tab and any tab holding staged edits. */
export function TabBar() {
  return html`
    <nav class="tab-nav">
      ${TABS.map(
        ([id, label]) => html`
          <button data-testid=${`tab-${id}`} class="${active.value === id ? "active" : ""}${dirtyTabs.value.has(id) ? " has-changes" : ""}" onClick=${() => (active.value = id)}>${label}</button>
        `,
      )}
    </nav>
  `;
}

/** Body of the active tab, falling back to the first registered tab when the active id matches none. */
export function TabBody() {
  const Body = (TABS.find((t) => t[0] === active.value) || TABS[0])[2];
  return html`<${Body} />`;
}
