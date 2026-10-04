// The Station builder's overview: the wizard's intro beside the signal chain, what the station holds (one line per
// part, › jumps to its step), its Matrix profiles (› the Profile builder), and the station picker.

import { h } from "../../../../lib/shell/dom.js";
import { holdRow } from "../../../../lib/builder/builder.js";
import { NEW } from "../../../../../../hqptuner/static/model/builders/builder.js";
import { STB_COPY, STB_STEPS } from "../../../../data/builders/station-builder.js";
import { ONE, paras } from "./parts.js";
import { answerOf } from "./answers.js";

/** @typedef {import('../../station-builder.js').StationState} StationState */

const HOLDS = ["backend", "device", "ipv6", "iface", "rates", "dac", "volume", "hardware"];

/**
 * The step holding `id`; every id in HOLDS is a step.
 *
 * @param {string} id
 */
const stepOf = (id) => /** @type {(typeof STB_STEPS)[number]} */ (STB_STEPS.find((y) => y.id === id));

/**
 * The overview page.
 *
 * @param {StationState} sb
 * @returns {HTMLElement}  the Station builder is a walk, so the shell lays its overview out
 */
export function overview(sb) {
  const { B, o } = sb;
  const cur = B.cur.name;
  const holds = HOLDS.map((id) => {
    const x = holdRow(stepOf(id).title, () => sb.show(id));
    x.a.textContent = answerOf(sb, id);
    return x.el;
  });
  const nProf = cur === NEW ? 0 : o.profilesOf(cur).length;
  const prof = holdRow(
    STB_COPY.profiles,
    () => {
      B.stash();
      B.setOn(false, false);
      o.openProfiles(B.cur.name);
    },
    "button.pbhold.pbpl",
  );
  prof.a.textContent = cur === NEW ? "—" : String(nProf);
  /** @type {HTMLButtonElement} */ (prof.el).disabled = cur === NEW;
  return /** @type {HTMLElement} */ (
    B.overview({
      tags: { ov: "div.pbov.stbov", save: "div.pbsavebox.stbsave", id: "div.pbid.stbid" },
      intro: h("div.pbintro", {}, paras(STB_COPY.intro)),
      holds: [holds, prof.el],
      chain: sb.chainEl,
      ask: B.ask && h("div.pbask", {}, B.askLine()),
      acts: sb.acts,
    })
  );
}

/**
 * The station picker (loaded and unsaved marks), the name box, and Delete (never on the loaded station).
 *
 * @param {StationState} sb
 */
export function paintPick(sb) {
  const { B, order, loaded } = sb;
  const isDirty = (/** @type {string} */ n) => B.isDirty({ st: ONE, name: n });
  B.pick.replaceChildren(
    ...order.map((n) =>
      h("option", { value: n, text: `${n}${n === loaded ? " (loaded)" : ""}${isDirty(n) ? " •" : ""}` }),
    ),
    h("option", { value: NEW, text: STB_COPY.newStation + (isDirty(NEW) ? " •" : "") }),
  );
  const cur = B.cur.name;
  B.pick.value = cur;
  /** @type {HTMLInputElement} */ (B.nameBox).value = sb.e.name;
  sb.acts.del.hidden = cur === NEW || cur === loaded; // the loaded station stays (load another first)
}
