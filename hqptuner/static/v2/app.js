// The v2 entry, served at /v2/ beside the v1 shell: the faceplate's root, mounted where the page has a mount point.
// Header and engine row stay; under them the chain body (rail, page, one drawer per rail stage over the page, each
// drawn from its registered schema, the page's plate-level popovers, and the option list a chain picker opens over the
// body with its hover tip), the Settings body the gear swaps in, the Snapshot builder's body, the Profile builder's
// body, or the empty body any other builder swaps in. Under the body, a hairline and the bottom bar. The connection
// panel the brand knob opens is a sheet over the body. The faceplate theme is stamped on the document root before the
// first render.
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
import { SnapshotBuilder } from "../components/faceplate/builders/SnapshotBuilder.js";
import { ProfileBuilder } from "../components/faceplate/builders/ProfileBuilder.js";
import { Switcher } from "../components/faceplate/bottom/Switcher.js";
import { ConnPanel } from "../components/faceplate/ConnPanel.js";
import { body } from "../store/faceplate/view.js";
import { watchFaceplateTheme } from "../store/faceplate/settings/visual.js";
import { railStages, railNow } from "../store/faceplate/chain.js";
import { startPolling } from "../store/sync.js";
import { initFavicon } from "../store/ui/favicon.js";
import { initHealth } from "../store/health.js";
import { initApodHistory } from "../store/apodhistory.js";
import { initSpectrogram } from "../store/meter/spectrogram.js";
import { initMeterFeed } from "../store/meter/feed.js";
import { startMeterLoop } from "../store/meter/loop.js";
import { bookWanted } from "../store/live/presets.js";
import { loadSpeakers } from "../store/matrix/speakers.js";
import { initSetup, pageHost } from "../store/setup.js";

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
 * The body for a name: the chain, Settings, the Snapshot builder, the Profile builder, or an empty body named for the
 * builder.
 *
 * @param {string} shown
 */
function shownBody(shown) {
  if (shown === "chain") return html`<${ChainBody} />`;
  if (shown === "settings") return html`<${SettingsBody} />`;
  if (shown === "snapshots") return html`<${SnapshotBuilder} />`;
  if (shown === "profile") return html`<${ProfileBuilder} />`;
  return html`<div class="body" data-body=${shown}></div>`;
}

/** The faceplate: header and engine row over the body that shows. */
export function Faceplate() {
  return html`
    <${Plate}>
      <${Header} />
      <${ConnPanel} />
      <div class="rule"></div>
      <${EngineRow} />
      <div class="rule"></div>
      ${shownBody(body.value)}
      <div class="rule botrule"></div>
      <${Switcher} />
    <//>
  `;
}

const root = globalThis.document?.getElementById?.("app");
if (root) {
  initFavicon();
  initHealth();
  initApodHistory();
  initSpectrogram();
  initMeterFeed();
  startMeterLoop();
  bookWanted.value = true;
  loadSpeakers();
  initSetup();
  pageHost.value = location.hostname;
  startPolling();
  watchFaceplateTheme(document.documentElement);
  render(html`<${Faceplate} />`, root);
}
