// The v2 entry, served at /v2/ beside the v1 shell: the faceplate's root, mounted where the page has a mount point.
// Header and engine row stay; under them the chain body (rail, page, one drawer per rail stage over the page, each
// drawn from its registered schema, the page's plate-level popovers, and the option list a chain picker opens over the
// body with its hover tip), the Settings body the gear swaps in, or the empty body a builder swaps in. The faceplate
// theme is stamped on the document root before the first render.
import { render } from "preact";
import { html } from "../lib/dom.js";
import { Plate } from "../components/faceplate/Plate.js";
import { Header } from "../components/faceplate/Header.js";
import { EngineRow } from "../components/faceplate/EngineRow.js";
import { Rail } from "../components/faceplate/Rail.js";
import { Page } from "../components/faceplate/Page.js";
import { Drawer } from "../components/faceplate/drawer/Drawer.js";
import { stageDrawer } from "../components/faceplate/drawers/index.js";
import { FilterPresets } from "../components/faceplate/page/FilterPresets.js";
import { OptionList } from "../components/faceplate/lists/OptionList.js";
import { ListTip } from "../components/faceplate/lists/Tip.js";
import { SettingsBody } from "../components/faceplate/settings/SettingsBody.js";
import { body } from "../store/faceplate/view.js";
import { watchFaceplateTheme } from "../store/faceplate/settings/visual.js";
import { railStages, railNow } from "../store/faceplate/chain.js";
import { startPolling } from "../store/sync.js";
import { initFavicon } from "../store/ui/favicon.js";
import { initHealth } from "../store/health.js";
import { bookWanted } from "../store/live/presets.js";
import { loadSpeakers } from "../store/matrix/speakers.js";

/** The chain body: rail, hairline, page, and the stage drawers over the page. */
function ChainBody() {
  const stages = railStages(railNow());
  return html`
    <div class="body" data-body="chain">
      <${Rail} />
      <div class="vrule"></div>
      <${Page} />
      ${stages.map((st) => {
        const { schema, blocks } = stageDrawer(st);
        return html`<${Drawer} key=${st.id} schema=${schema} blocks=${blocks} />`;
      })}
      <${FilterPresets} />
      <${OptionList} />
      <${ListTip} />
    </div>
  `;
}

/**
 * The body for a name: the chain, Settings, or an empty body named for the builder.
 *
 * @param {string} shown
 */
function shownBody(shown) {
  if (shown === "chain") return html`<${ChainBody} />`;
  if (shown === "settings") return html`<${SettingsBody} />`;
  return html`<div class="body" data-body=${shown}></div>`;
}

/** The faceplate: header and engine row over the body that shows. */
export function Faceplate() {
  return html`
    <${Plate}>
      <${Header} />
      <div class="rule"></div>
      <${EngineRow} />
      <div class="rule"></div>
      ${shownBody(body.value)}
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
  watchFaceplateTheme(document.documentElement);
  render(html`<${Faceplate} />`, root);
}
