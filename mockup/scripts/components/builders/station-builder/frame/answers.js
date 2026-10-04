// The Station builder's answers: what the rail and the overview print for each step (`Skipped` where it doesn't apply).

import { STB_COPY, STB_STEPS, hwSettings } from "../../../../data/builders/station-builder.js";
import { minus } from "../../../../model/shell/format.js";
import { deviceParts as parts } from "../../../../model/gauges/output.js";
import { skipOf, summaryOf } from "../../../../model/builders/station.js";

const IFACE_SHORT = { usb: "USB / I2S", coax: "AES/EBU · coax", toslink: "Toslink" }; // DRAFT rail readouts
const CUDA_SHORT = { 0: "No CUDA", convolution: "CUDA conv.", 1: "CUDA full" };

/** Each step's answer from the station's summary; `T` holds the borrowed tables. */
const TEXT = {
  name: (s) => s.name || "—",
  backend: (s) => ({ network: "NAA", alsa: "ALSA" })[s.backend],
  device: (s) => (s.device ? parts(s.backend, s.device).main : s.listings ? `${s.listings} listings` : "—"),
  ipv6: (s, T) => (s.discovery != null ? T.DISCOVERY.find((x) => x.v === s.discovery).label : "—"),
  usb: (s) => (s.resolved ? "Resolved" : "Unresolved"),
  iface: (s) => IFACE_SHORT[s.iface] ?? "—",
  rates: (s, T) =>
    s.limits
      ? `${T.TIERS[s.limits.pcm].name} · ${s.limits.sdm == null ? "no DSD" : "DSD" + T.TIERS[s.limits.sdm].name.slice(0, -1)}`
      : "—",
  dac: (s) => `${s.bits ? s.bits + " bit" : "Auto"} · ${minus(s.gain)} dB`,
  volume: (s) => (s.volume === "hqp" ? "HQPlayer" : s.volume === "other" ? `Fixed · ${minus(s.headroom)} dB` : "—"),
  hardware: (s) => [CUDA_SHORT[s.cuda], s.ecores && "E-cores"].filter(Boolean).join(" · "),
};

/** Why the step doesn't apply to the station being edited ('' = it does). */
export const skipText = (sb, id) => skipOf(STB_STEPS, id, sb.e.rec, sb.e.hw);

/** The step's answer for the station being edited. */
export function answerOf(sb, id) {
  if (skipText(sb, id)) return STB_COPY.skipped;
  return TEXT[id](summaryOf(sb.e.name, sb.e.rec, hwSettings(sb.e.hw)), sb.T);
}
