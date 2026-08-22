// Live view of the hqplayerd log tail, revealed by a checkbox that DEFAULTS to
// the logging state: log_enabled on -> tail shown until the user unchecks it
// (shown=null means "follow the config"). Deliberately a STATIC 50-line window
// (not a growing stream): each poll replaces the whole buffer with the current
// last-50 lines. Polls every 3 s only while shown, and stops on unmount so a
// backgrounded tab isn't hitting the file lane.
import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { effective } from "../store/resolve.js";
import { Checkbox } from "./controls/index.js";
import { truthy } from "../lib/coerce.js";

const LINES = 50;
const POLL_MS = 3000;
// how close to the bottom still counts as "at the bottom". Fractional layout
// leaves scrollTop a hair short of scrollHeight - clientHeight even when the
// pane is visually parked at the end, so an exact comparison would unstick
// itself the moment the browser rounded against us.
const STICK_PX = 4;
const COPIED_MS = 1500;

const shown = signal(null); // null = follow log_enabled; true/false = user choice
const lines = signal([]);
const message = signal(""); // reason when the tail isn't available (logging off, unreadable)
// `ReturnType` rather than `number`: this file is checked under both configs,
// and the browser's `setInterval` answers a number where node's answers a
// `Timeout`. The handle is only ever passed back to `clearInterval`, so which
// one it is never matters here.
/** @type {ReturnType<typeof setInterval> | null} the open poll interval, or null when not polling */
let timer = null;

async function refresh() {
  try {
    const r = await api.log(LINES);
    if (r.available) {
      lines.value = r.lines || [];
      message.value = "";
    } else {
      lines.value = [];
      message.value = r.reason ? `Log tail unavailable — ${r.reason}.` : "Log tail unavailable.";
    }
  } catch (e) {
    lines.value = [];
    message.value = `Log tail request failed: ${e}`;
  }
}

// The hand-back runs over plain HTTP on the LAN, which is not a secure context,
// so `navigator.clipboard` is simply absent in every browser but on localhost.
// The deprecated execCommand path is the only one that works there.
/** @param {string} text @returns {Promise<void>} resolves once the text is on the clipboard, rejects if it isn't */
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("clipboard rejected the copy");
  } finally {
    ta.remove();
  }
}

/** @param {string} state "ok" after a copy, "fail" after a failed one, "" at rest @returns {string} the copy button's label */
function label(state) {
  if (state === "ok") return "Copied";
  if (state === "fail") return "Copy failed";
  return "Copy";
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Checkbox-gated pane holding the last 50 hqplayerd log lines, polling while shown and sticking to the newest line only while the reader is already there. */
export function LogTail() {
  const pre = useRef(null);
  // Sticky-bottom, not pin-to-bottom: a reader who has scrolled up is reading,
  // and yanking them back every 3 s made the pane unusable. Sampled in the
  // render body because that is the last moment the DOM still holds the OLD
  // content — by the time a layout effect runs, the new lines are already in
  // and the old scroll position no longer means anything.
  const stick = useRef(true);
  const el = pre.current;
  if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
  const [copied, setCopied] = useState("");
  const on = shown.value === null ? truthy(effective("log_enabled")) : shown.value;
  const text = lines.value.join("\n");
  // poll while shown; stop when hidden or the tab unmounts
  useEffect(() => {
    stop();
    if (on) {
      refresh();
      timer = setInterval(refresh, POLL_MS);
    }
    return stop;
  }, [on]);
  useLayoutEffect(() => {
    const node = pre.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  });
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(""), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await copyToClipboard(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  };
  return html`
    <div class="log-tail-wrap">
      <div class="log-tail-head">
        <label data-testid="logtail-toggle" class="log-tail-toggle">
          <${Checkbox} value=${on ? "1" : "0"} onChange=${(/** @type {string | number} */ v) => (shown.value = v === "1")} />
          Show live log tail (last ${LINES} lines)
        </label>
        ${on && lines.value.length ? html`<button type="button" class="btn" data-copy=${copied || "idle"} onClick=${copy}>${label(copied)}</button>` : null}
      </div>
      ${
        on
          ? message.value
            ? html`<div class="log-tail-msg">${message.value}</div>`
            : html`<pre class="log-tail" ref=${pre}>${text}</pre>`
          : null
      }
    </div>
  `;
}
