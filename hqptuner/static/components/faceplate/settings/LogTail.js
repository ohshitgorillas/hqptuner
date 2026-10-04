// The Logging drawer's live log tail block: HQPTuner v1's tail on the faceplate. A static window of the last 50 lines of
// the daemon's log, each poll replacing the whole buffer, polled every 3 s while the Logging drawer is open and stopped
// when it closes or the block unmounts. A failed request prints its line in the pane's place. Copy puts the window on
// the clipboard and reads its outcome for 1.5 s. Read-only: nothing here stages.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { PLATFORM } from "../../../lib/clock.js";
import { copyToClipboard } from "../../../lib/clipboard.js";
import { revertAfter } from "../../../model/shell/timing.js";
import { logLines, logMessage, refreshLogTail } from "../../../store/logtail.js";
import { openStage } from "../../../store/faceplate/view.js";

/** @typedef {import("../../../lib/clock.js").Clock} Clock */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */

const LINES = 50;
const POLL_MS = 3000;
const COPIED_MS = 1500;
// How close to the bottom still counts as at the bottom: fractional layout leaves scrollTop a hair short of the end
// even when the pane is parked there.
const STICK_PX = 4;

/** @param {string} state "ok" after a copy, "fail" after a failed one, "" at rest @returns {string} the button's label */
function label(state) {
  if (state === "ok") return "Copied";
  if (state === "fail") return "Copy failed";
  return "Copy";
}

/**
 * The live log tail: the head with Copy, the paragraph, and the pane.
 *
 * @param {{ schema: DrawerSchema, here: XrefHere, clock?: Clock }} props  clock: the one the poll and Copy's revert run on
 */
export function LogTailBlock({ clock = PLATFORM }) {
  const pre = useRef(/** @type {HTMLPreElement | null} */ (null));
  // Sticky-bottom, not pin-to-bottom: a reader scrolled up is reading. Sampled in the render body, the last moment the
  // DOM still holds the old content.
  const stick = useRef(true);
  const el = pre.current;
  if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  const [copied, setCopied] = useState("");
  const restore = useMemo(() => revertAfter(COPIED_MS, () => setCopied(""), clock), [clock]);
  const open = openStage.value === "logging";
  const text = logLines.value.join("\n");
  useEffect(() => {
    if (!open) return undefined;
    refreshLogTail(LINES);
    const timer = clock.setInterval(() => refreshLogTail(LINES), POLL_MS);
    return () => clock.clearInterval(timer);
  }, [open, clock]);
  useLayoutEffect(() => {
    const node = pre.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  });
  const copy = async () => {
    try {
      await copyToClipboard(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    restore();
  };
  return html`
    <div class="drow ltrow">
      <div class="ctl">
        <div class="fh"><b>Live log tail</b></div>
        <div class="act">
          <button type="button" class="btn xs" data-copy=${copied || "idle"} onClick=${copy}>${label(copied)}</button>
        </div>
      </div>
      <div class="man"><p>Live stream of the hqplayerd log (file or journal). Read-only.</p></div>
    </div>
    ${
      logMessage.value
        ? html`<p class="mnote">${logMessage.value}</p>`
        : html`<pre class="logtail" ref=${pre}>${text}</pre>`
    }
  `;
}

/** The components the Logging drawer's block items mount, by name. */
export const LOGTAIL_BLOCKS = { logtail: LogTailBlock };
