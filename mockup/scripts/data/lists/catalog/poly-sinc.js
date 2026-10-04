import { derive, same } from "../derive.js";
import { sdm16x, twoStage } from "./sides.js";

/** @typedef {import("./sides.js").CatalogFilter} CatalogFilter */

/** @type {CatalogFilter[]} */
const BASE = [
  {
    v: "poly-sinc-lp",
    label: "Poly-sinc · Linear",
    group: "Polyphase sinc",
    man: 'Linear phase polyphase sinc filter. Very high quality linear phase resampling filter that can perform most of the typical conversion ratios. Good phase response, but has some amount of pre-ringing. See "FIR" for further details.',
  },
  {
    v: "poly-sinc-mp",
    label: "Poly-sinc · Minimum",
    group: "Polyphase sinc",
    man: "Minimum phase polyphase sinc filter, otherwise similar to poly-sinc. Altered phase response, but no pre-ringing. See minphaseFIR for further details.",
  },
  {
    v: "poly-sinc-short-lp",
    label: "Poly-sinc · Short linear",
    group: "Polyphase sinc",
    man: "Otherwise similar to poly-sinc, but shorter pre- and post-ringing at the expense of filtering quality (not as sharp roll-off).",
  },
  {
    v: "poly-sinc-short-mp",
    label: "Poly-sinc · Short minimum",
    group: "Polyphase sinc",
    man: "Minimum phase variant of poly-sinc-short. Otherwise similar to poly-sinc-mp, but shorter post-ringing. Most optimal transient reproduction.",
  },
  {
    v: "poly-sinc-long-lp",
    label: "Poly-sinc · Long linear",
    group: "Polyphase sinc",
    man: "Otherwise similar to poly-sinc, but longer pre- and post-ringing with improved filtering quality (faster roll-off).",
  },
  {
    v: "poly-sinc-long-ip",
    label: "Poly-sinc · Long intermediate",
    group: "Polyphase sinc",
    man: "Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing, and improved filtering quality (faster roll-off).",
  },
  {
    v: "poly-sinc-long-mp",
    label: "Poly-sinc · Long minimum",
    group: "Polyphase sinc",
    man: "Minimum phase variant of poly-sinc-long. Otherwise similar to poly-sinc-mp, but longer post-ringing with improved filtering quality (faster roll-off).",
  },
];

/** @type {CatalogFilter[]} */
const HALF_BAND = [
  {
    v: "poly-sinc-hb",
    label: "Poly-sinc · Half-band · Linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase half-band filter with steep roll-off and high attenuation. Only suitable for highest technical quality source materials.",
  },
];

/** The half-band lengths, which SDM runs in two stages only. @type {CatalogFilter[]} */
const HALF_BAND_LENGTHS = [
  {
    v: "poly-sinc-hb-xs",
    label: "Poly-sinc · Half-band · X-short linear",
    group: "Polyphase sinc",
    man: "Extremely short linear phase polyphase half-band filter with slow roll-off and low attenuation. Only suitable for highest technical quality source materials.",
  },
  {
    v: "poly-sinc-hb-s",
    label: "Poly-sinc · Half-band · Short linear",
    group: "Polyphase sinc",
    man: "Short linear phase polyphase half-band filter with slow roll-off and average attenuation. Only suitable for highest technical quality source materials.",
  },
  {
    v: "poly-sinc-hb-m",
    label: "Poly-sinc · Half-band · Medium linear",
    group: "Polyphase sinc",
    man: "Medium linear phase polyphase half-band filter with average roll-off and medium attenuation. Only suitable for highest technical quality source materials.",
  },
  {
    v: "poly-sinc-hb-l",
    label: "Poly-sinc · Half-band · Long linear",
    group: "Polyphase sinc",
    man: "Long linear phase polyphase half-band filter with fast roll-off and high attenuation. Only suitable for highest technical quality source materials.",
  },
];

/** @type {CatalogFilter[]} */
const EXTENDED = [
  {
    v: "poly-sinc-ext",
    label: "Poly-sinc · Extended · Linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter with sharper roll-off and somewhat lower stop-band attenuation, while being roughly equal in length to poly-sinc.",
  },
  {
    v: "poly-sinc-ext2",
    label: "Poly-sinc · Extended v2 · Linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter with sharp roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure.",
  },
  {
    v: "poly-sinc-ext2-short",
    label: "Poly-sinc · Extended v2 · Short linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter with slow roll-off and high stop-band attenuation for extended frequency response. Optimal frequency response and harmonic structure.",
  },
  {
    v: "poly-sinc-ext2-medium",
    label: "Poly-sinc · Extended v2 · Medium linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter with fast roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure.",
  },
  {
    v: "poly-sinc-ext2-long",
    label: "Poly-sinc · Extended v2 · Long linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter with very fast roll-off and very high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure.",
  },
  {
    v: "poly-sinc-ext2-xla",
    label: "Poly-sinc · Extended v2 · X-long linear, apod",
    group: "Polyphase sinc",
    man: "Very steep 8x longer version of poly-sinc-ext2-long.",
  },
  {
    v: "poly-sinc-ext2-xl",
    label: "Poly-sinc · Extended v2 · X-long linear",
    group: "Polyphase sinc",
    man: "Very steep 8x longer non-apodizing version of poly-sinc-ext2-long. Only suitable for highest technical quality source materials.",
  },
  {
    v: "poly-sinc-ext2-hires-lp",
    label: "Poly-sinc · Extended v2 · Hi-res linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.",
  },
  {
    v: "poly-sinc-ext2-hires-ip",
    label: "Poly-sinc · Extended v2 · Hi-res intermediate",
    group: "Polyphase sinc",
    man: "Intermediate phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.",
  },
  {
    v: "poly-sinc-ext2-hires-mp",
    label: "Poly-sinc · Extended v2 · Hi-res minimum",
    group: "Polyphase sinc",
    man: "Minimum phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.",
  },
  {
    v: "poly-sinc-mqa/mp3-lp",
    label: "Poly-sinc · MQA/MP3 · Linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter optimized for playing back MQA- or MP3-encoded content in order to clean up high frequency noise added by the MQA or MP3 encoding. Also suitable for upsampling PCM sources of ≥ 88.2 kHz sampling rate, especially for hi-res PCM recordings of ≥ 176.4 kHz sampling rate. Very short ringing. Early slow roll-off.",
  },
  {
    v: "poly-sinc-mqa/mp3-mp",
    label: "Poly-sinc · MQA/MP3 · Minimum",
    group: "Polyphase sinc",
    man: "Minimum phase variant of poly-sinc-mqa.",
  },
];

/** @type {CatalogFilter[]} */
const EXTREME = [
  {
    v: "poly-sinc-xtr-lp",
    label: "Poly-sinc · Extreme · Linear",
    group: "Polyphase sinc",
    man: "Linear phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
  {
    v: "poly-sinc-xtr-mp",
    label: "Poly-sinc · Extreme · Minimum",
    group: "Polyphase sinc",
    man: "Minimum phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
  {
    v: "poly-sinc-xtr-short-lp",
    label: "Poly-sinc · Extreme · Short linear",
    group: "Polyphase sinc",
    man: "Short linear phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
  {
    v: "poly-sinc-xtr-short-mp",
    label: "Poly-sinc · Extreme · Short minimum",
    group: "Polyphase sinc",
    man: "Short minimum phase polyphase sinc filter with extreme roll-off and attenuation.",
  },
];

/** @type {CatalogFilter[]} */
const GAUSSIAN = [
  {
    v: "poly-sinc-gauss-short",
    label: "Poly-sinc · Gauss · Short linear",
    group: "Polyphase sinc",
    man: "Short Gaussian polyphase sinc filter. Optimal time-frequency response.",
  },
  {
    v: "poly-sinc-gauss-medium",
    label: "Poly-sinc · Gauss · Medium linear",
    group: "Polyphase sinc",
    man: "Gaussian polyphase sinc filter. Optimal time-frequency response.",
  },
  {
    v: "poly-sinc-gauss-long",
    label: "Poly-sinc · Gauss · Long linear",
    group: "Polyphase sinc",
    man: "Long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response.",
  },
  {
    v: "poly-sinc-gauss-xla",
    label: "Poly-sinc · Gauss · X-long linear, apod",
    group: "Polyphase sinc",
    man: "Apodizing extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response.",
  },
  {
    v: "poly-sinc-gauss-xl",
    label: "Poly-sinc · Gauss · X-long linear",
    group: "Polyphase sinc",
    man: "Extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response.",
  },
  {
    v: "poly-sinc-gauss-hires-lp",
    label: "Poly-sinc · Gauss · Hi-res linear",
    group: "Polyphase sinc",
    man: "Linear phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.",
  },
  {
    v: "poly-sinc-gauss-hires-ip",
    label: "Poly-sinc · Gauss · Hi-res intermediate",
    group: "Polyphase sinc",
    man: "Intermediate phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.",
  },
  {
    v: "poly-sinc-gauss-hires-mp",
    label: "Poly-sinc · Gauss · Hi-res minimum",
    group: "Polyphase sinc",
    man: "Minimum phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.",
  },
  {
    v: "poly-sinc-gauss-halfband",
    label: "Poly-sinc · Gauss half-band · Linear",
    group: "Polyphase sinc",
    man: "Linear phase half-band Gaussian filter. Slightly leaky around Nyquist, but extremely high attenuation. Only suitable for highest technical quality source materials.",
  },
  {
    v: "poly-sinc-gauss-halfband-s",
    label: "Poly-sinc · Gauss half-band · Short linear",
    group: "Polyphase sinc",
    man: "Short linear phase half-band Gaussian filter. Leaky around Nyquist, but high attenuation. Only suitable for highest technical quality source materials.",
  },
];

export const PCM_POLY_SINC_CATALOG = derive(
  [...BASE, ...HALF_BAND, ...HALF_BAND_LENGTHS, ...EXTENDED, ...EXTREME, ...GAUSSIAN],
  same,
);

// SDM lists the base, half-band and extreme filters again in their two-stage form, after the single-stage ones.
export const SDM_POLY_SINC_CATALOG = [
  ...derive([...BASE, ...HALF_BAND], same),
  ...derive(HALF_BAND_LENGTHS, twoStage),
  ...derive(EXTENDED, sdm16x),
  ...derive(EXTREME, same),
  ...derive([...BASE, ...HALF_BAND, ...EXTREME], twoStage),
  ...derive(GAUSSIAN, sdm16x),
];
