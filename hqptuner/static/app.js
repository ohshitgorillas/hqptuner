// Entry point: start polling the backend, mount the app.
import { render } from "preact";
import { html } from "./lib/dom.js";
import { App } from "./components/App.js";
import { startPolling } from "./store/sync.js";
import { initTheme } from "./store/theme.js";
import { initFavicon } from "./store/favicon.js";
import { initHealth } from "./store/health.js";
import { initApodHistory } from "./store/apodhistory.js";

initTheme();
initFavicon();
initHealth();
initApodHistory();
startPolling();
render(html`<${App} />`, document.getElementById("app"));
