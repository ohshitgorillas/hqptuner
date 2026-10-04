// GENERATED from the HQPTuner repo (engine-enums.json, *-plain-names.json, filters.json, shapers.json). Strings
// verbatim; do not hand-edit. Option: {v: engine name, fam, var: plain-name family / variant, leaf: the Simplified
// row text, f?: narrowing facets (filters), tier?: DSD rate floor badge (modulators), gen?: generation (modulators),
// d: hover-tip prose as v1 Simplified shows it, d2?: the Standard prose where it differs (v1 store/prose.js)}.
// Overlay order.

import { DITHERS } from "./options/dithers.js";
import { MODULATORS } from "./options/modulators.js";
import { PCM_ANALOG_STYLE, SDM_ANALOG_STYLE } from "./options/filters/analog-style.js";
import { PCM_CONVENTIONAL, SDM_CONVENTIONAL } from "./options/filters/conventional.js";
import { PCM_INTERPOLATION, SDM_INTERPOLATION } from "./options/filters/interpolation.js";
import { PCM_MISC } from "./options/filters/misc.js";
import { PCM_POLY_SINC_BASE, SDM_POLY_SINC_BASE } from "./options/filters/poly-sinc-base.js";
import { PCM_POLY_SINC_EXTENDED, SDM_POLY_SINC_EXTENDED } from "./options/filters/poly-sinc-extended.js";
import { PCM_POLY_SINC_EXTENDED_V2, SDM_POLY_SINC_EXTENDED_V2 } from "./options/filters/poly-sinc-extended-v2.js";
import { PCM_POLY_SINC_EXTREME, SDM_POLY_SINC_EXTREME } from "./options/filters/poly-sinc-extreme.js";
import { PCM_POLY_SINC_GAUSSIAN, SDM_POLY_SINC_GAUSSIAN } from "./options/filters/poly-sinc-gaussian.js";
import {
  PCM_POLY_SINC_GAUSSIAN_HALF_BAND,
  SDM_POLY_SINC_GAUSSIAN_HALF_BAND,
} from "./options/filters/poly-sinc-gaussian-half-band.js";
import { PCM_POLY_SINC_HALF_BAND, SDM_POLY_SINC_HALF_BAND } from "./options/filters/poly-sinc-half-band.js";
import { PCM_POLY_SINC_MQA_MP3, SDM_POLY_SINC_MQA_MP3 } from "./options/filters/poly-sinc-mqa-mp3.js";
import { PCM_PURE_SINC, SDM_PURE_SINC } from "./options/filters/pure-sinc.js";

export const LISTS = {
  pcmFilters: [
    ...PCM_ANALOG_STYLE,
    ...PCM_CONVENTIONAL,
    ...PCM_POLY_SINC_BASE,
    ...PCM_POLY_SINC_GAUSSIAN,
    ...PCM_POLY_SINC_EXTENDED,
    ...PCM_POLY_SINC_EXTENDED_V2,
    ...PCM_POLY_SINC_EXTREME,
    ...PCM_POLY_SINC_HALF_BAND,
    ...PCM_POLY_SINC_GAUSSIAN_HALF_BAND,
    ...PCM_POLY_SINC_MQA_MP3,
    ...PCM_INTERPOLATION,
    ...PCM_PURE_SINC,
    ...PCM_MISC,
  ],
  sdmFilters: [
    ...SDM_ANALOG_STYLE,
    ...SDM_CONVENTIONAL,
    ...SDM_POLY_SINC_BASE,
    ...SDM_POLY_SINC_GAUSSIAN,
    ...SDM_POLY_SINC_EXTENDED,
    ...SDM_POLY_SINC_EXTENDED_V2,
    ...SDM_POLY_SINC_EXTREME,
    ...SDM_POLY_SINC_HALF_BAND,
    ...SDM_POLY_SINC_GAUSSIAN_HALF_BAND,
    ...SDM_POLY_SINC_MQA_MP3,
    ...SDM_INTERPOLATION,
    ...SDM_PURE_SINC,
  ],
  modulators: MODULATORS,
  dithers: DITHERS,
};

export const GROUPS = {
  filters: {
    families: {
      "Analog-style": "Analog-like behavior; no pre-ringing, long post-ringing",
      Conventional: "Common, efficient filter types found in most DACs",
      "Polyphase sinc": "The most variety and flexibility",
      Interpolation: "Generates new samples along a curve rather than by filtering",
      "Pure sinc": "Brute force linear phase filters",
      Misc: "Miscellaneous filters",
    },
    variants: {
      "Conventional|Classic oversampling": "Cheap, short, low-load filters",
      "Conventional|Minimum ringing": "Minimizes ringing at the cost of response and suppression",
      "Conventional|Brickwall": "A steeper cut with pre-ringing on strong transients; adjustable length",
      "Polyphase sinc|Base": "The family's base form",
      "Polyphase sinc|Extended frequency response": "Keeps response wide while fully cutting off at the limit",
      "Polyphase sinc|Extended frequency response v2":
        "Sharper version of extended response, stronger suppression above the audio band",
      "Polyphase sinc|Extreme roll-off and attenuation": "Steepest cutoff and strongest suppression",
      "Polyphase sinc|Gaussian": "Best balance of time and frequency accuracy; cleanest transients",
      "Polyphase sinc|Gaussian half-band": "Gaussian character with a slightly leaky response at the cutoff",
      "Polyphase sinc|Half-band": "Response reaches the cutoff; for clean, well-mastered sources",
      "Polyphase sinc|MQA and MP3": "Tailored for lossy sources",
      "Pure sinc|Base": "The family's base form",
      "Pure sinc|Extended frequency response v2":
        "Sharper version of extended response, stronger suppression above the audio band",
      "Pure sinc|Gaussian": "Best balance of time and frequency accuracy; cleanest transients",
      "Pure sinc|Rate-flexible": "Capable of any rate change at the cost of a higher processing load",
      "Interpolation|Closed form": "An approximation-free solution to defining the inter-sample curve",
      "Interpolation|Polynomial": "Slow roll-off and weak ultrasonic suppression",
    },
  },
  modulators: {
    families: {
      Fixed: "Same behavior regardless of source",
      Adaptive: "Adapts to the source; all choices are strong, so pick by ear, not by load",
      Hybrid: "Multi-level and multi-bit designs",
    },
    variants: {
      "Fixed|Fifth order": "Suits DACs with simple analog reconstruction filters; recommended for ESS Sabre DACs",
      "Fixed|Seventh order": "Best for most DACs, but asks more of the hardware's analog filter",
      "Adaptive|Fifth order": "Suits DACs with simple analog reconstruction filters; recommended for ESS Sabre DACs",
      "Adaptive|Seventh order": "Best for most DACs, but asks more of the hardware's analog filter",
      "Hybrid|Fifth order": "Suits DACs with simple analog reconstruction filters; recommended for ESS Sabre DACs",
      "Hybrid|Seventh order": "Best for most DACs, but asks more of the hardware's analog filter",
    },
  },
  dithers: {
    families: {
      "Noise shaping": "Pushes noise above the hearing range via error feedback loop; optimal for R-2R DACs",
      Additive: "Evens out low-level distortions by adding random noise",
      None: "No noise treatment; provided as a reference, not for critical listening",
    },
    variants: {},
  },
};

export const APOD_HINT =
  'The need for an apodizing filter is based on detected errors that originate from the recording ADC or mastering tools. Apodizing filters should be used at least when the "Apod" counter increments to higher than 10 during any single track. There is no harm in using an apodizing filter for content that doesn\'t need one, but there is harm in using non-apodizing filters for content that would need one.';
