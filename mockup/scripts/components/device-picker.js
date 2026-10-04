// Output device picker. Engine device strings split on ": ":
//   network  "host: card: interface"  → button shows card big, "host · interface" small; list grouped by host
//   alsa     "card: interface"        → button shows interface big, card small; list grouped by card

import { h } from "../lib/dom.js";
import { popover } from "../lib/popover.js";
import { deviceParts, groupDevices } from "../model/output.js";

/**
 * @param {HTMLElement} host   empty .devpick container
 * @param {{kind:string, aria:string}} cfg
 * @param {{list:string[], selected:number}} devices
 * @param {() => void} onChange
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

  function paint() {
    const p = deviceParts(kind, devices.list[sel]);
    main.textContent = p.main;
    sub.textContent = kind === "network" ? p.group + (p.detail ? " · " + p.detail : "") : p.group;

    list.replaceChildren(
      ...groupDevices(kind, devices.list).flatMap(({ group, rows }) => [
        h("div.gh", {}, h("span", { text: group }), h("span.ln")),
        ...rows.map((q) => {
          const { i } = q;
          const cur = i === sel;
          return h(
            "button.devrow",
            {
              type: "button",
              class: cur && "cur",
              role: "option",
              aria: { selected: cur },
              on: {
                click: () => {
                  if (i !== sel) {
                    sel = i;
                    onChange();
                  }
                  paint();
                  pop.close();
                },
              },
            },
            h("span.lamp", { class: cur && "on" }),
            h("span.m", { text: q.main }),
            q.detail && h("span.d", { text: q.detail }),
          );
        }),
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
