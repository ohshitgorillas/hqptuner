// The v2 entry, served at /v2/ beside the v1 shell: the faceplate's root, mounted where the page has a mount point.
// Header and engine row stay; under them the chain body (rail, page, and one drawer per rail stage over the page) or
// the body a builder or the gear swaps in.
import { render } from "preact";
import { html } from "../lib/dom.js";
import { Plate } from "../components/faceplate/Plate.js";
import { Header } from "../components/faceplate/Header.js";
import { EngineRow } from "../components/faceplate/EngineRow.js";
import { Rail } from "../components/faceplate/Rail.js";
import { Page } from "../components/faceplate/Page.js";
import { Drawer } from "../components/faceplate/drawer/Drawer.js";
import { body } from "../store/faceplate/view.js";
import { railStages, railNow } from "../store/faceplate/chain.js";
import { startPolling } from "../store/sync.js";
import { initFavicon } from "../store/ui/favicon.js";
import { initHealth } from "../store/health.js";
import { bookWanted } from "../store/live/presets.js";
import { loadSpeakers } from "../store/matrix/speakers.js";

/** @typedef {import("../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/**
 * A rail stage's drawer before its rows are drawn: its title and nothing under it.
 *
 * @param {{ id: string, name: string }} stage
 * @returns {DrawerSchema}
 */
const bare = ({ id, name }) => ({ id, title: name, aria: name, tabs: [{ id: "main", label: name, body: [] }] });

/** The chain body: rail, hairline, page, and the stage drawers over the page. */
function ChainBody() {
  const stages = railStages(railNow());
  return html`
    <div class="body" data-body="chain">
      <${Rail} />
      <div class="vrule"></div>
      <${Page} />
      ${stages.map((st) => html`<${Drawer} key=${st.id} schema=${bare(st)} />`)}
    </div>
  `;
}

/** The faceplate: header and engine row over the body that shows. */
export function Faceplate() {
  const shown = body.value;
  return html`
    <${Plate}>
      <${Header} />
      <div class="rule"></div>
      <${EngineRow} />
      <div class="rule"></div>
      ${shown === "chain" ? html`<${ChainBody} />` : html`<div class="body" data-body=${shown}></div>`}
    <//>
  `;
}

const root = globalThis.document?.getElementById?.("app");
if (root) {
  initFavicon();
  initHealth();
  bookWanted.value = true;
  loadSpeakers();
  startPolling();
  render(html`<${Faceplate} />`, root);
}
