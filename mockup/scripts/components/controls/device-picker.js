// Output device picker. Engine device strings split on ": ":
//   network  "host: card: interface"  → button shows card big, "host · interface" small; list grouped by host
//   alsa     "card: interface"        → button shows interface big, card small; list grouped by card

import { h } from "../../lib/shell/dom.js";
import { popover } from "../../lib/shell/popover.js";
import { deviceParts, groupDevices } from "../../../../hqptuner/static/model/gauges/output.js";

/** @typedef {import('../../../../hqptuner/static/model/gauges/output.js').DeviceRow} DeviceRow */

/**
 * Mount the picker: a trigger showing the selected device, and its listbox of devices under their group headers.
 * Returns the selection as a value the drawer can read and put back.
 *
 * @param {HTMLElement} host   empty .devpick container
 * @param {{kind:string, aria:string}} cfg
 * @param {{list:string[], selected:number}} devices
 * @param {() => void} onChange
 * @returns {{value: () => string, setValue: (v: string | number) => void}}
 */
export function mountDevicePicker(host, { kind, aria }, devices, onChange) {
  let sel = devices.selected;
  const main = h("span.v"),
    sub = h("span.l"),
    arrow = h("span.ar", { text: "▼" });
  const trigger = h(
    "button.vfd.devbtn",
    { type: "button", aria: { haspopup: "listbox", label: aria } },
    h("span.tx", {}, main, sub),
    arrow,
  );
  const list = h("div.devlist", { role: "listbox" });
  host.append(trigger, list);

  const pop = popover({
    trigger,
    panel: list,
    onToggle: (open) => {
      arrow.textContent = open ? "▲" : "▼";
    },
  });

  /** @param {number} i */
  function pick(i) {
    if (i !== sel) {
      sel = i;
      onChange();
    }
    paint();
    pop.close();
  }

  function paint() {
    const p = deviceParts(kind, devices.list[sel]);
    main.textContent = p.main;
    sub.textContent = kind === "network" ? p.group + (p.detail ? " · " + p.detail : "") : p.group;

    list.replaceChildren(
      ...groupDevices(kind, devices.list).flatMap(({ group, rows }) => [
        h("div.gh", {}, h("span", { text: group }), h("span.ln")),
        ...rows.map((q) => deviceRow(q, q.i === sel, () => pick(q.i))),
      ]),
    );
  }
  paint();
  // Discard (mock): the drawer reads the picked device and puts it back.
  return {
    value: () => String(sel),
    setValue: (v) => {
      sel = Number(v);
      paint();
    },
  };
}

/**
 * One device in the list: its lamp, name and detail; `cur` marks the selected one.
 *
 * @param {DeviceRow} q
 * @param {boolean} cur
 * @param {() => void} onPick
 * @returns {HTMLButtonElement}
 */
function deviceRow(q, cur, onPick) {
  return h(
    "button.devrow",
    {
      type: "button",
      class: cur && "cur",
      role: "option",
      aria: { selected: cur },
      on: { click: onPick },
    },
    h("span.lamp", { class: cur && "on" }),
    h("span.m", { text: q.main }),
    q.detail && h("span.d", { text: q.detail }),
  );
}
