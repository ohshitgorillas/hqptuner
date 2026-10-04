// The v2 entry, served at /v2/ beside the v1 shell: the faceplate's root, mounted where the page has a mount point.
import { render } from "preact";
import { html } from "../lib/dom.js";
import { Plate } from "../components/faceplate/Plate.js";
import { startPolling } from "../store/sync.js";
import { initFavicon } from "../store/ui/favicon.js";
import { initHealth } from "../store/health.js";

/** The faceplate: the plate and the frame's rows on it. */
export function Faceplate() {
  return html`<${Plate} />`;
}

const root = globalThis.document?.getElementById?.("app");
if (root) {
  initFavicon();
  initHealth();
  startPolling();
  render(html`<${Faceplate} />`, root);
}
