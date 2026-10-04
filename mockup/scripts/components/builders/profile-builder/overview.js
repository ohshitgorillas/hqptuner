import { h } from "../../../lib/shell/dom.js";
import { chainPic, holdRow } from "../../../lib/builder/builder.js";
import { NEW } from "../../../../../hqptuner/static/model/builders/builder.js";
import { PROFILE_COPY, PB_STEPS, PB_COPY, MATRIX_STAGES, OUTSIDE_STAGES } from "../../../data/builders/profiles.js";
import { show } from "../profile-builder.js";
import { pencil } from "./parts.js";

/** @typedef {import('./records.js').PB} PB */

// Overview
/**
 * Mount the overview: what the profile holds, the picker's change, the Stations menu, the description, the ways on.
 *
 * @param {PB} pb
 */
export function mountOverview(pb) {
  const { B, pick } = pb;
  pb.holdRows = ["eq", "crossfeed", "correction", "loudness"].map((id) => ({
    id,
    ...holdRow(/** @type {{ title: string }} */ (PB_STEPS.find((x) => x.id === id)).title, () => show(pb, id)),
  }));
  pick.addEventListener("change", () => {
    const [st, name] = pick.value === NEW ? [pb.home, NEW] : pick.value.split("\u0001");
    B.go({ st, name });
  });
  /** Stations menu (Snapshot builder's): ✓ = Save writes there; a station already holding this name shows it. */
  pb.stMenu = B.stationsMenu({
    ticked: () => pb.meta.stations,
    name: () => pb.meta.name,
    pick: (list) => {
      pb.meta.stations = list;
      pb.stMenu.paint();
      B.paintState();
    },
  });
  const desc = h("textarea", {
    "aria-label": "Profile description",
    spellcheck: "false",
    maxlength: 500,
    placeholder: PROFILE_COPY.desc,
  });
  desc.addEventListener("input", () => {
    pb.meta.desc = desc.value;
    B.paintState();
  });
  pb.desc = desc;
  pb.acts = B.buttons();
  pb.askHost = h("div.pbask");
  const overview = B.overview({
    intro: h("p.pbintro", { text: PB_COPY.intro }),
    holds: [pb.holdRows.map((r) => r.el), pb.plBtn],
    chain: chainPic(
      "Signal chain: the matrix engine's part lit",
      (id) => MATRIX_STAGES.includes(id),
      (id) => OUTSIDE_STAGES.includes(id),
    ),
    ids: [pb.stMenu.el],
    mid: [h("label.desc.pbdesc", {}, desc, pencil())],
    ask: pb.askHost,
    acts: pb.acts,
    after: h(
      "button.pbadvlink",
      { type: "button", on: { click: () => show(pb, "advanced") } },
      PB_COPY.advanced,
      h("span", { "aria-hidden": "true", text: " ›" }),
    ),
  });
  pb.overview = /** @type {HTMLElement} */ (overview);
}
