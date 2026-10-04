// The Station builder's page: which page shows (the overview or one step's), each step's frame and guide line.

import { h } from "../../../../lib/shell/dom.js";
import { closeOthers } from "../../../drawers/drawer.js";
import { stepContext } from "../../../../model/builders/station.js";
import { lines, rich } from "./parts.js";
import { overview, paintPick } from "./overview.js";
import { nameStep } from "../steps/name.js";
import { backendStep } from "../steps/backend.js";
import { deviceStep } from "../steps/device.js";
import { ipv6Step } from "../steps/ipv6.js";
import { usbStep } from "../steps/usb.js";
import { ifaceStep } from "../steps/iface.js";
import { ratesStep } from "../steps/rates.js";
import { dacStep } from "../steps/dac.js";
import { volumeStep } from "../steps/volume.js";
import { hardwareStep } from "../steps/hardware.js";

const STEP = {
  name: nameStep,
  backend: backendStep,
  device: deviceStep,
  ipv6: ipv6Step,
  usb: usbStep,
  iface: ifaceStep,
  rates: ratesStep,
  dac: dacStep,
  volume: volumeStep,
  hardware: hardwareStep,
};

/** The guide line; a step whose guide is null (Rates over USB) prints its check there instead: the wizard's order. */
function guideOf(sb, id, skip, st) {
  const g = skip || st.guide(stepContext(sb.e.rec, sb.e.hw));
  if (g == null) return sb.runs[id] ? h("div.stbguiderun", {}, lines(sb.runs[id])) : h("p.pbguide", { text: " " });
  return h("p.pbguide", { class: skip && "skip" }, rich(g));
}

/** A step's page (the shell's frame): the wizard's guide line, then its rows. */
const stepPage = (sb, id) =>
  sb.B.stepPage(id, {
    tag: "div.pbstepp.stbstep",
    attrs: { data: { step: id } },
    guide: (skip, st) => guideOf(sb, id, skip, st),
    rows: (x) => STEP[x](sb),
  });

/** Show a page (an id outside the walk shows the overview); leaving a step closes what it had open. */
export function show(sb, id) {
  if (!sb.B.inWalk(id)) id = "overview";
  closeOthers(null);
  if (id !== "device" && sb.at === "device") sb.bringUp = false;
  if (id !== "volume") sb.pitch = false;
  sb.at = id;
  if (id === "overview") {
    sb.page.replaceChildren(overview(sb));
    paintPick(sb);
  } else sb.page.replaceChildren(stepPage(sb, id));
  sb.B.paintRail();
  sb.B.paintState();
}
