// Device step (wizard §1.3): the backend's devices under their group headers, Refresh devices, and the NAA bring-up
// (§1.2), on demand and on its own whenever an NAA backend lists nothing.

import { h } from "../../../../lib/shell/dom.js";
import { DEVICES } from "../../../../data/stages/output.js";
import { STB_DEVICE, STB_USB } from "../../../../data/builders/station-builder.js";
import { classNames } from "../../../../model/shell/format.js";
import { deviceView } from "../../../../model/builders/station.js";
import { rich, tip } from "../frame/parts.js";

/** @typedef {import('../../station-builder.js').StationState} StationState */
/** @typedef {import('../../../../model/builders/station.js').DeviceLine} DeviceLine */

/**
 * Pick or drop a listing; a changed pick unlocks the pair and forgets its check.
 *
 * @param {StationState} sb
 * @param {string} str
 */
function toggle(sb, str) {
  sb.set((x) => {
    x.listings = x.listings.includes(str) ? x.listings.filter((l) => l !== str) : [...x.listings, str];
    x.resolved = null;
  });
  delete sb.runs.usb;
}

/**
 * One device line: its checkbox, its name and detail, and the locked-in tag.
 *
 * @param {StationState} sb
 * @param {DeviceLine} p
 */
function deviceLine(sb, p) {
  const { str } = p;
  return h(
    "div.stbdev",
    { class: classNames(p.on && "on", p.dead && "dead") },
    h("button.binc", {
      type: "button",
      role: "checkbox",
      aria: { checked: p.on, label: p.main },
      on: { click: () => toggle(sb, str) },
    }),
    h(
      "button.stbdn",
      { type: "button", on: { click: () => toggle(sb, str) } },
      h("span.m", { text: p.main }),
      p.detail && h("span.d", { text: p.detail }),
    ),
    p.locked && h("span.tag.stblock", { text: STB_USB.locked }),
  );
}

/**
 * The NAA bring-up: the three flavors, the firewall warning, Refresh devices and (with devices found) the way back.
 *
 * @param {StationState} sb
 * @param {number} found  how many listings the list offers
 * @param {HTMLElement} refresh  Refresh devices and its cost, lent to the bring-up's action row
 */
function bringUpView(sb, found, refresh) {
  const U = STB_DEVICE.bringUp;
  return [
    h(
      "div.stbbring",
      {},
      !found && h("p.stbnone", { text: STB_DEVICE.none }),
      h("p", { text: U.intro }),
      h(
        "ol",
        {},
        U.flavors.map((f) => h("li", {}, h("b", { text: f.k }), ": ", rich(f.text))),
      ),
      tip("HQPTuner Tips:", U.tip),
      h("p", { text: U.ready }),
      h(
        "div.stbcrit",
        { role: "note" },
        h("b", { text: U.critical }),
        h("p", {}, rich(U.firewall)),
        U.cmds.map((c) => h("p.stbcmd", {}, h("span", { text: c.k }), h("code", { text: c.cmd }))),
        h("p", {}, rich(U.fallback)),
      ),
    ),
    h(
      "div.stbact",
      {},
      refresh.children[0],
      refresh.children[1],
      h("span.grow"),
      found > 0 &&
        h("button.btn.sm", {
          type: "button",
          text: U.back,
          on: {
            click: () => {
              sb.bringUp = false;
              sb.show("device");
            },
          },
        }),
    ),
  ];
}

/**
 * Refresh devices (the mock's NAA shows from then on) and what it costs.
 *
 * @param {StationState} sb
 * @returns {HTMLElement}
 */
function refreshRow(sb) {
  return h(
    "div.stbact",
    {},
    h("button.btn.sm", {
      type: "button",
      text: STB_DEVICE.refresh,
      on: {
        click: () => {
          sb.naaSeen = true;
          sb.o.onRescan?.();
          sb.show("device");
        },
      },
    }),
    h("span.stbcost", { text: STB_DEVICE.refreshCost }),
  );
}

/**
 * The notes under the list: same-device and two-listing advice, the manual's paragraph, and (NAA) the bring-up link.
 *
 * @param {StationState} sb
 * @param {boolean} net  the backend is NAA
 */
function deviceNotes(sb, net) {
  return h(
    "div.stbnotes",
    {},
    h("p", { text: STB_DEVICE.same }),
    h("p", { text: STB_DEVICE.both }),
    h("p.stbman", { text: net ? sb.T.MAN.netDevice : sb.T.MAN.alsaDevice }),
    net &&
      h(
        "p",
        {},
        h(
          "button.xref.stblink",
          {
            type: "button",
            on: {
              click: () => {
                sb.bringUp = true;
                sb.show("device");
              },
            },
          },
          STB_DEVICE.bringUpLink,
          " ›",
        ),
      ),
  );
}

/**
 * The Device step's rows.
 *
 * @param {StationState} sb
 */
export function deviceStep(sb) {
  const kind = sb.e.rec.backend;
  const net = kind === "network";
  const v = deviceView({
    kind,
    all: net ? DEVICES.network.list : DEVICES.alsa.list,
    rec: sb.e.rec,
    hidden: sb.hidden,
    naaSeen: sb.naaSeen,
    bringUp: sb.bringUp,
  });
  const refresh = refreshRow(sb);
  if (v.bringUp) return bringUpView(sb, v.found, refresh);
  const well = h(
    "div.stbdevs",
    { role: "group", "aria-label": "Output devices" },
    v.groups.flatMap(({ group, rows }) => [
      h("div.gh", {}, h("span", { text: group }), h("span.ln")),
      ...rows.map((p) => deviceLine(sb, p)),
    ]),
  );
  return [h("div.drow.drow-full.stbdrow", {}, well, refresh), deviceNotes(sb, net)];
}
