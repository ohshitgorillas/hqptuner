// Root: chrome (header + signal path) over the tabs, with the pending bar
// pinned at the bottom. Every child re-renders off the signals store — no props
// threaded through.
//
// LIVE is a mode, not a tab. On, it replaces the tab bar, the tab body and the
// pending bar with the LIVE page: those three are the staged-edit workflow, and
// LIVE has no staged edits to show. The switch itself stays put in either mode —
// it sits on the tab-bar row so turning LIVE on costs no vertical space.
import { html } from "../lib/dom.js";
import { Header } from "./Header.js";
import { SignalPath } from "./SignalPath.js";
import { AlertStrip } from "./AlertStrip.js";
import { TabBar, TabBody } from "./tabs/index.js";
import { LiveView } from "./LiveView.js";
import { PendingBar } from "./PendingBar.js";
import { reachable } from "../store/state.js";
import { liveMode, setLiveMode } from "../store/prefs.js";

function LiveSwitch() {
  const on = liveMode.value;
  return html`
    <button
      type="button"
      class="live-toggle ${on ? "on" : ""}"
      aria-pressed=${on}
      title=${on ? "Leave LIVE and go back to the tabs" : "Show only the settings the engine can change right now"}
      onClick=${() => setLiveMode(!on)}
    >
      LIVE
    </button>
  `;
}

export function App() {
  const live = liveMode.value;
  return html`
    <div class="app ${reachable.value ? "" : "offline"}">
      <div class="chrome-top">
        <${Header} />
        <${SignalPath} />
        <${AlertStrip} />
        <div class="chrome-tabs">
          ${live ? null : html`<${TabBar} />`}
          <${LiveSwitch} />
        </div>
      </div>
      <main>${live ? html`<${LiveView} />` : html`<${TabBody} />`}</main>
      ${live ? null : html`<${PendingBar} />`}
    </div>
  `;
}
