// IPv6 step (wizard §1.4): Yes runs the confirm check, I don't know offers the test (Start) or IPv4 (Skip); Discovery
// sits below with the manual's paragraph.

import { h } from "../../../../lib/shell/dom.js";
import { seg } from "../../../controls/seg.js";
import { STB_STEPS, STB_IPV6 } from "../../../../data/builders/station-builder.js";
import { choice, drow, lines } from "../frame/parts.js";
import { testV6 } from "../frame/checks.js";

/** The I-don't-know answer's rows: the lead, then Start / Skip, or the test's lines once it runs. */
function unknownRows(sb, run) {
  const out = [
    h("div.stbnotes", {}, h("p", { text: STB_IPV6.unknown.lead }), !run && h("p", { text: STB_IPV6.unknown.ask })),
  ];
  const skip = () => {
    sb.set((y) => {
      y.v6 = "v4";
    });
    sb.show(sb.B.nextOf(STB_STEPS.findIndex((s2) => s2.id === "ipv6")));
  };
  if (!run)
    out.push(
      h(
        "div.stbact",
        {},
        h("button.btn.sm", { type: "button", text: STB_IPV6.unknown.start, on: { click: () => testV6(sb, true) } }),
        h("button.btn.sm", { type: "button", text: STB_IPV6.unknown.skip, on: { click: skip } }),
      ),
    );
  else out.push(lines(run));
  return out;
}

/** The IPv6 step's rows. */
export function ipv6Step(sb) {
  const x = sb.e.rec;
  const run = sb.runs.ipv6;
  const answerRows = [
    choice(
      "",
      STB_IPV6.answers,
      x.ipv6,
      (v) => {
        delete sb.runs.ipv6;
        sb.set((y) => {
          y.ipv6 = v;
          if (v === "no") y.v6 = "v4";
        });
        if (v === "yes") testV6(sb, false);
      },
      { fold: true },
    ),
  ];
  if (x.ipv6 === "yes") answerRows.push(lines(run));
  if (x.ipv6 === "unknown") answerRows.push(...unknownRows(sb, run));
  const disc = seg({
    aria: "Discovery",
    options: sb.T.DISCOVERY,
    value: x.v6,
    onChange: (v) =>
      sb.set((y) => {
        y.v6 = v;
      }),
  });
  return [...answerRows, drow("Discovery", disc, sb.T.MAN.discovery, "stbset")];
}
