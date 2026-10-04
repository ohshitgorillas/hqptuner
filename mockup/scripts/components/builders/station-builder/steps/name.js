// Name step (wizard §1): the station's name, the matrix-profiles tip, and the link to the NAA bring-up.

import { h } from "../../../../lib/shell/dom.js";
import { STB_COPY, STB_TIPS } from "../../../../data/builders/station-builder.js";
import { drow, tip } from "../frame/parts.js";

/** The Name step's rows. */
export function nameStep(sb) {
  const { e, B } = sb;
  const box = h("input.vfd.stbnm", {
    type: "text",
    "aria-label": "Station name",
    value: e.name,
    maxlength: 40,
    spellcheck: "false",
    placeholder: STB_COPY.name,
  });
  box.value = e.name;
  box.addEventListener("input", () => {
    sb.e.name = box.value.trim();
    B.refused = false;
    B.paintRail();
  });
  const [a, link, b] = STB_TIPS.power;
  const bringUp = () => {
    sb.set((x) => {
      x.backend = "network";
    });
    sb.bringUp = true;
    sb.show("device");
  };
  return [
    drow("Name", box, ""),
    h(
      "div.stbnotes",
      {},
      tip("HQPTuner Tips:", STB_TIPS.name),
      h("p", {}, a, h("button.xref.stblink", { type: "button", text: link, on: { click: bringUp } }), b),
    ),
  ];
}
