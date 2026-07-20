// Live view of the hqplayerd log tail — off by default, revealed by a checkbox.
// Deliberately a STATIC 50-line window (not a growing stream): each poll replaces
// the whole buffer with the current last-50 lines. Polls every 3 s only while
// shown, and stops on unmount so a backgrounded tab isn't hitting the file lane.
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { html } from "../store/dom.js";
import { api } from "../store/api.js";
import { Checkbox } from "./controls/index.js";

const LINES = 50;
const POLL_MS = 3000;

const shown = signal(false);
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

function toggle(on) {
  shown.value = on;
  stop();
  if (on) {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  }
}

export function LogTail() {
  const pre = useRef(null);
  useEffect(() => stop, []); // clear the interval if the tab unmounts
  // newest lines are at the bottom — keep the view pinned there on every refresh
  useEffect(() => {
    const el = pre.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return html`
    <div class="log-tail-block">
      <label class="log-tail-toggle">
        <${Checkbox} value=${shown.value ? "1" : "0"} onChange=${(v) => toggle(v === "1")} />
        Show live log tail (last ${LINES} lines)
      </label>
      ${shown.value
        ? message.value
          ? html`<div class="log-tail-msg">${message.value}</div>`
          : html`<pre class="log-tail" ref=${pre}>${lines.value.join("\n")}</pre>`
        : null}
    </div>
  `;
}
