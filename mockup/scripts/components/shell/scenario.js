// Mock scenario switch: what is playing (data/scenarios.js). A viewing tool, not app UI: it sits in its
// own strip above the plate, outside the faceplate, so it can't be read as part of the design. `#scene-<id>` in the URL
// opens on that scenario (idle, pcm1x, pcmnx, dsd64). The Alerts group raises mock alerts (mountAlertPicker).

import { h } from "../../lib/shell/dom.js";
import { seg } from "../controls/seg.js";
import { popover } from "../../lib/shell/popover.js";

/**
 * First group on the strip: the scenario switch, one segment per scenario, `value` picked.
 *
 * @param {HTMLElement} host   #scene strip
 * @param {{id: string, label: string}[]} scenes
 * @param {string} value
 * @param {(id: string) => void} onChange
 */
export function mountScenario(host, scenes, value, onChange) {
  host.append(
    h("span.eng", { text: "Scenario" }),
    seg({
      aria: "Mock scenario: what is playing",
      cls: "view",
      value,
      options: scenes.map((s) => ({ v: s.id, label: s.label })),
      onChange,
    }),
    h("span.cnt", { text: "mockup only · not part of the app" }),
  );
}

/**
 * Second group on the same strip: which alerts to raise (data/alerts.js MOCK_ALERTS), a button reading how many are picked
 * that opens a checklist under it. `#alerts-<kind>,<kind>` in the URL opens with those picked.
 * @param {HTMLElement} host   #scene strip
 * @param {{kind: string, label: string, when?: string}[]} items  the alerts on offer (data/alerts.js MOCK_ALERTS)
 * @param {string[]} kinds   the kinds to open picked (model/flags.js `alerts`)
 * @param {(kinds: Set<string>) => void} onChange
 * @returns {Set<string>}
 */
export function mountAlertPicker(host, items, kinds, onChange) {
  const picked = new Set(kinds);
  const txt = h("span");
  const btn = h("button.btn.sm.scalerts", { type: "button", aria: { haspopup: "dialog" } }, txt, " ▾");
  const panel = h(
    "div.pop.scapop",
    { role: "dialog", "aria-label": "Mock alerts" },
    items.map((i) =>
      h(
        "label.chk",
        {},
        h("input", {
          type: "checkbox",
          checked: picked.has(i.kind),
          on: {
            change: (/** @type {Event} */ e) => {
              /** @type {HTMLInputElement} */ (e.target).checked ? picked.add(i.kind) : picked.delete(i.kind);
              paint();
              onChange(new Set(picked));
            },
          },
        }),
        h("span", { text: i.label }),
        i.when && h("span.cnt", { text: i.when }),
      ),
    ),
  );
  const paint = () => {
    txt.textContent = picked.size ? `${picked.size} raised` : "None";
    btn.classList.toggle("on", picked.size > 0);
  };
  paint();
  const note = host.querySelector(".cnt:last-child");
  host.insertBefore(h("span.eng", { text: "Alerts" }), note);
  host.insertBefore(btn, note);
  document.body.append(panel);
  popover({
    trigger: btn,
    panel,
    onToggle: (open) => {
      if (!open) return;
      const r = btn.getBoundingClientRect();
      panel.style.left = `${r.left}px`;
      panel.style.top = `${r.bottom + 6}px`;
    },
  });
  return new Set(picked);
}

/**
 * Third group on the strip: the display size the plate is laid out at (lib/plate.js SIZES): 10.2″ | 11″ | 13″, iPad
 * landscape in points. The app reflows to it, as on that iPad; the window still scales the plate down to fit.
 * `#size-<id>` in the URL opens on that size (size-11, size-13).
 * @param {HTMLElement} host   #scene strip
 * @param {{id: string, label: string, w: number, h: number, model: string}[]} sizes
 * @param {string} value
 * @param {(id: string) => void} onChange
 */
export function mountSizePicker(host, sizes, value, onChange) {
  const note = host.querySelector(".cnt:last-child");
  const pts = h("span.cnt.scpts");
  /** @param {string} id  one of `sizes` */
  const paint = (id) => {
    const z = /** @type {(typeof sizes)[number]} */ (sizes.find((x) => x.id === id));
    pts.textContent = `${z.w}×${z.h} pt`;
    pts.title = z.model;
  };
  const el = seg({
    aria: "Mock display size (iPad, landscape)",
    cls: "view",
    value,
    options: sizes.map((z) => ({ v: z.id, label: z.label, title: `${z.model} · ${z.w}×${z.h} pt` })),
    onChange: (id) => {
      paint(id);
      onChange(id);
    },
  });
  paint(value);
  host.insertBefore(h("span.eng", { text: "Display" }), note);
  host.insertBefore(el, note);
  host.insertBefore(pts, note);
}
