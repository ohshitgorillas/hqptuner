// Entry point: start polling the backend, mount the app.
import { render } from "preact";
import { html } from "./lib/dom.js";
import { App } from "./components/App.js";
import { startPolling } from "./store/sync.js";
import { initTheme } from "./store/theme.js";
import { initFavicon } from "./store/favicon.js";
import { initHealth } from "./store/health.js";
import { initSetup } from "./store/setup.js";
import { initApodHistory } from "./store/apodhistory.js";

initTheme();
initFavicon();
initHealth();
// Starts the connection panel's grace period from this page load, so a page
// opened while the backend is still connecting does not read that as an
// install with nowhere to dial.
initSetup();
initApodHistory();
startPolling();
render(html`<${App} />`, document.getElementById("app"));
