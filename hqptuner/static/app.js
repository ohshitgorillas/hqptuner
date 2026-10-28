// The entry, served at /: the faceplate's root, mounted where the page has a mount point.
// Header and engine row show on every view, with the plate's alert lines between them; under them the chain body
// (rail, page, one drawer per rail stage over the page, each drawn from its registered schema, the page's plate-level
// popovers, and the option list a chain picker opens over the body with its hover tip), the Settings body the gear
// swaps in, the Snapshot builder's body with the same option list and tip for its list pickers, the Profile builder's
// body, or the empty body any other builder swaps in. Under the body, a hairline and the bottom bar. The connection
// panel the brand knob opens is a sheet over the body. The faceplate theme is stamped on the document root before the
// first render.
import { html, mount, watchGestures } from "./lib/dom.js";
import { Plate } from "./components/faceplate/Plate.js";
import { Header } from "./components/faceplate/Header.js";
import { EngineRow } from "./components/faceplate/EngineRow.js";
import { Rail } from "./components/faceplate/Rail.js";
import { Page } from "./components/faceplate/Page.js";
import { Drawer } from "./components/faceplate/drawer/Drawer.js";
import { stageDrawer } from "./components/faceplate/drawers/index.js";
import { FilterPresets } from "./components/faceplate/page/FilterPresets.js";
import { DisplayOptions } from "./components/faceplate/page/DisplayOptions.js";
import { OptionList } from "./components/faceplate/lists/OptionList.js";
import { ListTip } from "./components/faceplate/lists/Tip.js";
import { SettingsBody } from "./components/faceplate/settings/SettingsBody.js";
import { SnapshotBuilder } from "./components/faceplate/builders/SnapshotBuilder.js";
import { ProfileBuilder } from "./components/faceplate/builders/ProfileBuilder.js";
import { Switcher } from "./components/faceplate/bottom/Switcher.js";
import { ConnPanel } from "./components/faceplate/ConnPanel.js";
import { AlertLines } from "./components/faceplate/AlertLines.js";
import { alertsNow } from "./store/faceplate/alerts.js";
import { body } from "./store/faceplate/view.js";
import { watchFaceplateTheme } from "./store/faceplate/settings/visual.js";
import { railStages, railNow } from "./store/faceplate/chain.js";
import { startSync } from "./store/sync.js";
import { initFavicon } from "./store/ui/favicon.js";
import { initHealth } from "./store/health.js";
import { initApodHistory } from "./store/apodhistory.js";
import { initSpectrogram } from "./store/meter/spectrogram.js";
import { initMeterFeed } from "./store/meter/feed.js";
import { initMeterLoop } from "./store/meter/loop.js";
import { bookWanted } from "./store/live/presets.js";
import { loadSpeakers } from "./store/matrix/speakers.js";
import { startNarrowing } from "./store/narrow/persist.js";
import { hydrateFavorites } from "./store/narrow/favorites.js";
import { hydrateMatrixModes } from "./store/matrix/mode.js";
import { hydrateDescriptions } from "./store/matrix/descriptions.js";
import { createConnPanel } from "./store/connpanel.js";

const panel = createConnPanel();

/** The chain body: rail, hairline, page, the stage drawers over the page, its popovers, and the option list and tip. */
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
      <${DisplayOptions} />
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
  if (shown === "snapshots") {
    return html`
      <${SnapshotBuilder}>
        <${OptionList} />
        <${ListTip} />
      <//>
    `;
  }
  if (shown === "profile") return html`<${ProfileBuilder} />`;
  return html`<div class="body" data-body=${shown}></div>`;
}

/** The lines the plate shows under its top bar; nothing while there are none. */
function PlateAlerts() {
  const alerts = alertsNow.value.plate;
  if (!alerts.length) return null;
  return html`
    <div class="dalert pline" role="status">
      <${AlertLines} alerts=${alerts} />
    </div>
  `;
}

/** The faceplate: header, the plate's alert lines and engine row over the body that shows, the bottom bar under it. */
export function Faceplate() {
  return html`
    <${Plate}>
      <${Header} panel=${panel} />
      <${PlateAlerts} />
      <${ConnPanel} panel=${panel} />
      <div class="rule"></div>
      <${EngineRow} />
      <div class="rule"></div>
      ${shownBody(body.value)}
      <div class="rule botrule"></div>
      <${Switcher} />
    <//>
  `;
}

/** Start the app on `doc`: favicon, health, APOD history, spectrogram, meter feed and loop, speakers, narrowing, favorites, matrix modes, descriptions, panel, sync, theme and gesture watch, then render the Faceplate into `doc`'s `#app`. Host name from `doc.defaultView.location`; every timer from `clock`. A document with no `#app` boots nothing. @param {Document} doc @param {typeof import("./lib/clock.js").PLATFORM} clock */
export function boot(doc, clock) {
  const root = doc.getElementById("app");
  if (!root) return;
  initFavicon(doc);
  initHealth(clock);
  initApodHistory();
  initSpectrogram();
  startSync(doc);
  initMeterFeed(clock);
  initMeterLoop(clock);
  bookWanted.value = true;
  loadSpeakers();
  startNarrowing(doc, clock);
  void hydrateFavorites();
  void hydrateMatrixModes();
  void hydrateDescriptions();
  panel.initPanel();
  panel.pageHost.value = doc.defaultView?.location.hostname ?? "";
  watchFaceplateTheme(doc.documentElement);
  watchGestures(doc);
  mount(html`<${Faceplate} />`, root);
}
