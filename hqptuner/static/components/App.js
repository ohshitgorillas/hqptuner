// Root: chrome (header + signal path) over the tabs, with the pending bar
// pinned at the bottom. Every child re-renders off the signals store — no props
// threaded through.
import { html } from "../store/dom.js";
import { Header } from "./Header.js";
import { SignalPath } from "./SignalPath.js";
import { TabNav } from "./tabs.js";
import { PendingBar } from "./PendingBar.js";
import { reachable } from "../store/state.js";

export function App() {
  return html`
    <div class="app ${reachable.value ? "" : "offline"}">
      <${Header} />
      <${SignalPath} />
      <main><${TabNav} /></main>
      <${PendingBar} />
    </div>
  `;
}
