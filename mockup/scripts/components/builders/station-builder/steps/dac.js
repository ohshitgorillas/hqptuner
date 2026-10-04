// DAC bits · Gain step (wizard §1.5, its last two paragraphs): DAC bits with the manual's known values, then PCM gain
// compensation (grayed without native DSD).

import { h } from "../../../../lib/shell/dom.js";
import { STB_DAC } from "../../../../data/builders/station-builder.js";
import { drow, num } from "../frame/parts.js";

/** The DAC bits · Gain step's rows. */
export function dacStep(sb) {
  const x = sb.e.rec;
  const native = x.limits.sdm != null && x.dsd === "native";
  const known = h(
    "div.stbknown",
    {},
    h("p", { text: STB_DAC.known }),
    STB_DAC.values.map((k) =>
      h(
        "button.stbkv",
        {
          type: "button",
          class: Number(x.bits) === k.v && "on",
          on: {
            click: () =>
              sb.set((y) => {
                y.bits = k.v;
              }),
          },
        },
        h("span", { text: k.k }),
        h("b", { text: String(k.v) }),
      ),
    ),
  );
  const bits = num(
    "DAC bits",
    "",
    x.bits,
    { min: 0, max: 32, step: 1 },
    (n) =>
      sb.set((y) => {
        y.bits = n;
      }),
    "0 = default",
  );
  const gain = num("PCM gain compensation", "dB", x.gaincomp, { min: -6, max: 0, step: 0.5 }, (n) =>
    sb.set((y) => {
      y.gaincomp = n;
    }),
  );
  return [
    drow("DAC bits", [bits, known], sb.T.MAN.bits, "stbset"),
    h("div.stbnotes", {}, h("p", { text: STB_DAC.gain })),
    drow(
      "PCM gain compensation",
      [h("div.stbg", { class: !native && "grayed" }, gain), !native && h("p.gr", { text: STB_DAC.gainSkip })],
      sb.T.VMAN.gain,
      "stbset",
    ),
  ];
}
