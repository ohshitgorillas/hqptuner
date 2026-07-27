// Live view of the hqplayerd log tail, revealed by a checkbox that DEFAULTS to
// the logging state: log_enabled on -> tail shown until the user unchecks it
// (shown=null means "follow the config"). Deliberately a STATIC 50-line window
// (not a growing stream): each poll replaces the whole buffer with the current
// last-50 lines. Polls every 3 s only while shown, and stops on unmount so a
// backgrounded tab isn't hitting the file lane.
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { effective } from "../store/state.js";
import { Checkbox } from "./controls/index.js";
import { truthy } from "../lib/coerce.js";

const LINES = 50;
const POLL_MS = 3000;

const shown = signal(null); // null = follow log_enabled; true/false = user choice
const lines = signal([]);
const message = signal(""); // reason when the tail isn't available (logging off, unreadable)
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

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function LogTail() {
  const pre = useRef(null);
  const on = shown.value === null ? truthy(effective("log_enabled")) : shown.value;
  // poll while shown; stop when hidden or the tab unmounts
  useEffect(() => {
    stop();
    if (on) {
      refresh();
      timer = setInterval(refresh, POLL_MS);
    }
    return stop;
  }, [on]);
  // newest lines are at the bottom — keep the view pinned there on every refresh
  useEffect(() => {
    const el = pre.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return html`
    <div>
      <label class="log-tail-toggle">
        <${Checkbox} value=${on ? "1" : "0"} onChange=${(v) => (shown.value = v === "1")} />
        Show live log tail (last ${LINES} lines)
      </label>
      ${
        on
          ? message.value
            ? html`<div class="log-tail-msg">${message.value}</div>`
            : html`<pre class="log-tail" ref=${pre}>${lines.value.join("\n")}</pre>`
          : null
      }
    </div>
  `;
}
