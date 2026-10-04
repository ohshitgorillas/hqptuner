// Rates step (wizard §1.5): over USB the 48k-family check runs first (its lines print in the guide line), then what the
// hardware supports: the readouts, the rate dial, DSD support and DSD rates. A connection that fixes the limits caps the
// dial there.

import { h } from "../../lib/dom.js";
import { seg } from "../seg.js";
import { mountRateDial } from "../rate-dial.js";
import { STB_IFACES, STB_RATES } from "../../data/station-builder.js";
import { ratesPhase, rateView, dialLimits } from "../../model/station.js";
import { drow, paras } from "./parts.js";
import { detect48 } from "./checks.js";

/** What the hardware supports: PCM, SDM and 48kHz DSD readouts (and the transport caution over USB). */
function readouts(sb, x, v) {
  const t = (i) => sb.T.TIERS[i];
  return h(
    "div.stbsum",
    {},
    h("p.stbhere", { text: STB_RATES.here }),
    h(
      "div.stbread",
      {},
      h(
        "div.vfd.stbro",
        {},
        h("span.l", { text: "PCM" }),
        h("span.v", {
          text: `${t(x.limits.pcm).name} · ${t(x.limits.pcm).f44} / ${t(x.limits.pcm).f48} ${t(x.limits.pcm).unit}`,
        }),
      ),
      h(
        "div.vfd.stbro",
        {},
        h("span.l", { text: "SDM" }),
        h("span.v", {
          text: v.noDsd
            ? STB_RATES.sdmNone
            : `DSD${t(x.limits.sdm).name.slice(0, -1)} · ${x.dsd === "dop" ? "via DoP" : "Native"}`,
        }),
      ),
      h("div.vfd.stbro", {}, h("span.l", { text: "48kHz DSD" }), h("span.v", { text: v.dsd48 ? "Yes" : "No" })),
    ),
    x.iface === "usb" && h("p.stbconf", { text: STB_RATES.confirm }),
  );
}

/** The rate dial, nothing playing; a move writes the limits. */
function dial(sb, v) {
  const dialEl = h("div.dial", { role: "group", "aria-label": "Rate limits" });
  const rd = mountRateDial(dialEl, { tiers: v.tiers, limits: v.dial, playing: 0 }, () => {
    const limits = dialLimits(rd.value(), v.noDsd);
    sb.set((y) => {
      y.limits = limits;
    });
  });
  dialEl._setPlaying(null); // nothing plays in a builder
  return dialEl;
}

/** The Rates step's rows. */
export function ratesStep(sb) {
  const x = sb.e.rec;
  const phase = ratesPhase(x, sb.runs.rates);
  if (phase === "unanswered") return [h("div.stbnotes", {}, h("p", { text: "Answer Connection first." }))]; // DRAFT
  if (phase === "detect") {
    sb.clock.queueMicrotask(() => detect48(sb));
    return [];
  }
  if (phase === "checking") return [];
  const v = rateView(x, STB_IFACES, sb.T.TIERS);
  const dialEl = dial(sb, v);
  const sum = readouts(sb, x, v);
  const { MAN, DSD_OPTS, DSD48_OPTS } = sb.T;
  const dsdSeg = seg({
    aria: "DSD support",
    options: DSD_OPTS,
    value: x.dsd,
    onChange: (d) =>
      sb.set((y) => {
        y.dsd = d;
      }),
  });
  const d48Seg = seg({
    aria: "DSD rates",
    options: DSD48_OPTS,
    value: x.dsd48,
    onChange: (d) =>
      sb.set((y) => {
        y.dsd48 = d;
      }),
  });
  const gray = v.noDsd ? STB_RATES.sdmNoneWhy : "";
  const g = (ctl) => h("div.stbg", { class: gray && "grayed" }, ctl);
  return [
    sum,
    h(
      "div.drow.drow-full",
      {},
      h("div.ctl", {}, h("div.fh", {}, h("b", { text: "Rate limits" }))),
      dialEl,
      h("div.man", {}, paras(MAN.rate)),
    ),
    drow("DSD support", [g(dsdSeg), gray && h("p.gr", { text: gray })], MAN.dsd, "stbset"),
    drow("DSD rates", g(d48Seg), MAN.dsd48, "stbset"),
  ];
}
