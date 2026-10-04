// Volume step (wizard §1.6): HQPlayer's volume or another; No asks about clipped material and offers the two hints,
// the second opening the pitch for HQPlayer's volume control.

import { h } from "../../../../lib/shell/dom.js";
import { STB_VOLUME } from "../../../../data/builders/station-builder.js";
import { choice, rich, tip } from "../frame/parts.js";

/** The No answer's rows: the clipping question, then the two hints (and the pitch while open). */
function otherRows(sb, x) {
  const { pitch } = sb;
  return [
    h("p.stbq", { text: STB_VOLUME.clip }),
    choice("", STB_VOLUME.clips, x.iso, (v) =>
      sb.set((y) => {
        y.iso = v;
      }),
    ),
    h(
      "div.stbnotes.stbhints",
      {},
      tip("HQPTuner Hint 1:", STB_VOLUME.hint1),
      h(
        "p",
        {},
        h("b", { text: "HQPTuner Hint 2:" }),
        " ",
        STB_VOLUME.hint2,
        " ",
        h("button.xref.stblink", {
          type: "button",
          text: pitch ? STB_VOLUME.less : STB_VOLUME.more,
          on: {
            click: () => {
              sb.pitch = !sb.pitch;
              sb.show("volume");
            },
          },
        }),
      ),
      pitch &&
        h(
          "div.stbpitch",
          {},
          h("p", {}, rich(STB_VOLUME.pitch[0])),
          h(
            "ol",
            {},
            STB_VOLUME.pitch.slice(1).map((pp) => h("li", {}, h("b", { text: pp.k }), ": ", rich(pp.text))),
          ),
        ),
    ),
  ];
}

/** The Volume step's rows. */
export function volumeStep(sb) {
  const x = sb.e.rec;
  const { VMAN } = sb.T;
  const use = STB_VOLUME.use.map((u) => ({ ...u, man: u.v === "hqp" ? [VMAN.off, u.sets] : VMAN.iso }));
  // The pitch open: the question's warning and the picked answer's paragraph give it their room.
  const ch = choice(
    "",
    use,
    x.volume,
    (v) =>
      sb.set((y) => {
        y.volume = v;
      }),
    { fold: x.volume === "other" },
  );
  if (sb.pitch) ch.classList.add("brief");
  const out = [!sb.pitch && h("div.stbnotes", {}, h("p", { text: STB_VOLUME.warn })), ch].filter(Boolean);
  if (x.volume === "other") out.push(...otherRows(sb, x));
  return out;
}
