// Root: chrome (header + signal path) over the tabs, with the pending bar
// pinned at the bottom. Every child re-renders off the signals store — no props
// threaded through.
//
// LIVE is a mode, not a tab. On, it replaces the tab bar, the tab body and the
// pending bar with the LIVE page: those three are the staged-edit workflow, and
// LIVE has no staged edits to show. The switch itself lives in the header
// (Header.js), which is the one row present in both modes — so it neither moves
// nor costs vertical space when the tab bar goes away.
import { html } from "../lib/dom.js";
import { Header } from "./Header.js";
import { SignalPath } from "./SignalPath.js";
import { AlertStrip } from "./AlertStrip.js";
import { TabBar, TabBody } from "./tabs/index.js";
import { LiveView } from "./live/View.js";
import { PendingBar } from "./PendingBar.js";
import { Setup } from "./Setup.js";
import { ready } from "../store/signals.js";
import { engineRestarting } from "../store/enginewrite.js";
import { liveMode } from "../store/prefs.js";

/** Root layout: header, signal path and alert strip over either the tab bar and body or the LIVE page, with the pending bar below. */
export function App() {
  const live = liveMode.value;
  return html`
    <!-- The dim says one thing: the engine is not there right now. That is true when a
         health reading says so, and it is true from the click of a write that takes the
         daemon down — readiness only learns that a poll later, and a short restart can pass
         between two polls unseen. A write the engine never leaves for raises neither. -->
    <div class="app ${ready.value && !engineRestarting.value ? "" : "offline"}">
      <div class="chrome-top">
        <${Header} />
        <${SignalPath} />
        <${AlertStrip} />
        <!-- The row stays in both modes even when it holds nothing: its rule is
             what closes the chrome off from the page below, and a rule that
             disappears with the tab bar would leave the LIVE page hanging off
             the signal path. -->
        <div class="chrome-tabs">${live ? null : html`<${TabBar} />`}</div>
      </div>
      <main>${live ? html`<${LiveView} />` : html`<${TabBody} />`}</main>
      ${live ? null : html`<${PendingBar} />`}
    </div>
    <!-- Outside .app deliberately: .app.offline dims the whole tree at --o-dim,
         and the panel opens on exactly the condition that sets that class. A
         child would be dimmed along with the page it is there to fix. -->
    <${Setup} />
  `;
}
