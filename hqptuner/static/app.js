// Entry point: start polling the backend, mount the app.
import { render } from "preact";
import { html } from "./lib/dom.js";
import { App } from "./components/App.js";
import { startPolling } from "./store/state.js";
import { initAccent } from "./store/theme.js";
import { initFavicon } from "./store/favicon.js";

initAccent();
initFavicon();
startPolling();
render(html`<${App} />`, document.getElementById("app"));
