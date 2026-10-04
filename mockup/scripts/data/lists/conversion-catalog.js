// GENERATED from the HQPTuner repo (engine-enums.json, config-form-6.0.4 fixture, *-plain-names.json, filters.json,
// shapers.json, settings.json). Strings verbatim; do not hand-edit. Option: {v: engine name, label: plain short title,
// group?: plain-name family (optgroup), man?: the option's manual prose}. Filters and shapers in engine order;
// DSD-source decoding in the config form's order. MAN = settings.json tooltips (manual copy).

import { DECIMATION_CATALOG } from "./catalog/decimation.js";
import { DITHER_CATALOG } from "./catalog/dithers.js";
import { INTEGRATOR_CATALOG } from "./catalog/integrators.js";
import { MODULATOR_CATALOG } from "./catalog/modulators.js";
import { NOISE_FILTER_CATALOG } from "./catalog/noise-filters.js";
import { PCM_FILTER_CATALOG, SDM_FILTER_CATALOG } from "./catalog/filters.js";
import { SDM_CONVERSION_CATALOG } from "./catalog/sdm-conversion.js";

export const CATALOG = {
  pcmFilters: PCM_FILTER_CATALOG,
  sdmFilters: SDM_FILTER_CATALOG,
  dithers: DITHER_CATALOG,
  modulators: MODULATOR_CATALOG,
  noiseFilters: NOISE_FILTER_CATALOG,
  decimation: DECIMATION_CATALOG,
  integrators: INTEGRATOR_CATALOG,
  sdmConversion: SDM_CONVERSION_CATALOG,
  fftSizes: ["128", "256", "512", "1024", "2048", "4096", "8192", "16384"],
};

export const MAN = {
  filter_1x:
    'This selection can be used to switch between resampling / oversampling filters, and has an impact on the available hardware sampling rates. Filter/oversampling selection for "1x" rates covers source sampling rates below 50 kHz, so-called base rates.',
  filter_nx: 'Filter selection for "Nx" rates covers everything above the 1x rates.',
  fft_length:
    "Length of the FFT filter. Default value is 512. Length affects the steepness of the filter: shorter lengths result in slower (gentler) roll-off, while higher lengths result in faster (steeper) roll-off. This setting is per each 2x cascade filter, so it is not conversion ratio dependent. Only applies when an FFT-family filter is selected.",
  pcm_dither:
    "Word-length algorithms. This selection can be used to switch between different word-length reduction algorithms. It is always recommended to use at least TPDF dither.",
  sdm_modulator:
    "The delta-sigma modulator used to produce SDM output. Fifth order modulators are more suitable for DACs that have simple analog reconstruction filters. Seventh order modulators provide better technical performance, but also put more demands on the DAC's analog reconstruction filter. Typically this means that fifth order modulators suit DACs that have one switching element while seventh order modulators have the potential for better performance on DACs that have multi-element switching arrays. DSD* modulators are fixed configuration ones while ASDM* modulators are adaptive in various ways based on the source signal. For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal.",
  direct_sdm:
    "Direct playback disables all processing when the source is DSD content and the output is SDM to a DSD device or file. Note! Direct playback will disable volume control and set PCM volume to a fixed -3 dBFS value.",
  dsd_gain_6db:
    'DSDIFF or DSF files should typically have 6 dB of headroom on the signal level. By selecting "+6 dB", 6 decibels of gain is applied, removing this headroom from the converted signal. This way the normal playback level reaches that of normal PCM. However, this may cause overloads with some source material and may require extra attenuation using the volume control.',
  sdm_integrator:
    "Three types of delta-sigma integrators are available for different SDM → SDM remodulation schemes. These affect mostly the frequency and phase response at the highest frequencies. Stated frequencies apply for the DSD64 source rate, and these frequencies scale as a function of the source sampling rate.",
  sdm_conversion:
    'Different options for SDM → SDM rate conversions. These affect the frequency aperture that is assumed to contain a useful signal in addition to increasing noise-shaping noise. For example, piano doesn\'t contain high-frequency harmonics; for such a case, "narrow" is suitable. Close-miked percussion usually contains high level high-frequency content so that "wide" may be more suitable. "XFi" is suitable for all cases and is the default.',
  pdm_filter:
    'Different types of noise filters for PCM output of DSD/SDM sources. These reduce the amount of ultrasonic noise present in the source data. Standard filtering leaves a low level of ultrasonic noise. Some loudspeakers with tweeters of low power-handling capability can be sensitive to this noise, especially when higher listening volumes are used. Also some poorly designed, or class-D, amplifiers can misbehave in the presence of such ultrasonic content. More aggressive noise filters can therefore be selected. These filters will also limit the bandwidth available for the audio content. When the processing output rate of a DSD source (assuming DSD64) is 88.2/96 kHz PCM, the use of extra noise filtering in addition to "standard" is less important, since most of the noise will be cut out. When the processing output rate of a DSDIFF or DSF source is 44.1/48 kHz, extra noise filtering in addition to "standard" is not needed and will reduce playback quality.',
  pdm_conversion: "These settings control DSD to PCM conversion algorithms.",
};

// filters.json two_stage_note: follows the prose of every option flagged twoStage (a '-2s' name).
export const TWO_STAGE =
  "Two stage oversampling: the first stage rate conversion is performed by at least a factor of 8 using the selected algorithm, then the signal is further converted to the final rate using an algorithm optimized for content already processed to at least 8x rate. This lowers overall CPU load while preserving the same conversion quality. Especially useful for the highest output rates.";
