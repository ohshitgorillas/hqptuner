// Narrow filters: facets that shrink the filter lists (list drawers, page and drawer pickers).
// Copy is owner copy, verbatim, from v1: the hints closing the quality, focus, phase, length and rate-change popovers
// (narrowbar/Facets.js), the apodizing and 1x-sources captions (settings.json dsp.apodizing tooltip, narrowbar/Stages.js),
// the intro caption and the favorites title (narrowbar/Bar.js, Facets.js). Rendered as captions under each facet (v1:
// captions while Setting descriptions is On). Counts are live: lib/narrow.js runs v1's matching over data/option-lists.js.
//
// Facet kinds:
//   chips   multi-select toggle chips; state = array of values. combine: has an AND/OR mode (state key `${key}Mode`).
//           Value '' = "Unspecified" (filters with no value for this facet).
//   toggle  one chip; state = boolean.
//   seg     one or more segmented rows; state per row key. The first option is the default (no tag). stage: '1x' | 'nx'
//           = the row narrows that stage's list only, and its counts are that stage's.
//   checks  checkboxes; state = boolean per item key.
// hint: paragraphs; each is a string or [bold lead-in, rest]. `prefix: true` opens the first with **HQPTuner Hints:**.

import { APOD_HINT } from "./option-lists.js";

// v1 intro caption (owner copy). Not placed: its wording ("the dropdowns below") predates the list sheet.
export const INTRO =
  "Reduce the number of filters in the dropdowns below by selecting which features you're looking for. Dropdown counts show the number of 1x/Nx filters resulting from (de)selecting that option. All narrowing data are sourced directly from the HQPlayer manual.";

// The facet bar along the list sheet's head in this order: quality, genre, focus, apodizing, length, phase, 1x sources, rate change, favorites. Each facet is a
// window reading its state; tapping it opens its controls with its hint, verbatim.
export const BAR = [
  [
    {
      kind: "seg",
      label: "Quality",
      prefix: true,
      hint: [
        "Quality ratings are relative to general-purpose use; lesser-rated filters can outperform higher-rated ones with the appropriate content.",
      ],
      rows: [
        {
          key: "quality",
          aria: "Quality",
          options: [
            { v: 0, label: "Any" },
            { v: 3, label: "≥ 3/5", tag: "Quality ≥ 3/5" },
            { v: 4, label: "≥ 4/5", tag: "Quality ≥ 4/5" },
            { v: 5, label: "5/5", tag: "Quality 5/5" },
          ],
        },
      ],
    },
    {
      kind: "chips",
      key: "genre",
      label: "Genre",
      combine: true,
      plural: "genres",
      options: [
        { v: "pop", label: "Pop & rock" },
        { v: "jazz", label: "Jazz & blues" },
        { v: "classical", label: "Classical" },
        { v: "electronic", label: "Electronic" },
        { v: "any", label: "All genres" },
      ],
    },
    {
      kind: "chips",
      key: "focus",
      label: "Focus",
      combine: true,
      plural: "focuses",
      prefix: true,
      hint: [
        "Select the properties you want emphasized by the filter.",
        [
          "Transients",
          " are sudden sounds like a snare hit or the leading edge of a plucked string; these filters emphasize clean reproduction of such events.",
        ],
        [
          "Timbre",
          " is how natural and realistic instruments and voices are rendered; these filters emphasize a more lifelike sound.",
        ],
        [
          "Space",
          " is how we perceive the spatial distribution of instruments within a recording; these filters emphasize the content's soundstage.",
        ],
      ],
      options: [
        { v: "transients", label: "Transients" },
        { v: "timbre", label: "Timbre" },
        { v: "space", label: "Space" },
      ],
    },
    {
      kind: "seg",
      label: "Apodizing",
      apod: true,
      hint: [APOD_HINT],
      rows: [
        {
          key: "apod1x",
          stage: "1x",
          aria: "Apodizing 1x",
          options: [
            { v: "all", label: "All" },
            { v: "only", label: "Only", tag: "Apodizing only" },
            { v: "half", label: "+½", tag: "Apodizing +½" },
          ],
        },
        {
          key: "apodNx",
          stage: "nx",
          aria: "Apodizing Nx",
          options: [
            { v: "all", label: "All" },
            { v: "only", label: "Only", tag: "Nx apodizing only" },
            { v: "half", label: "+½", tag: "Nx apodizing +½" },
          ],
        },
      ],
    },
    {
      kind: "chips",
      key: "length",
      label: "Length",
      plural: "lengths",
      prefix: true,
      hint: [
        "Length represents a trade-off between cleaner transients and an improved sense of space through better filtering or junk removal. Shorter filters ring less and produce cleaner transients at the cost of less filtering; longer filters smear transients more in time but are more capable at filtering the junk.",
      ],
      options: [
        { v: "xshort", label: "Extra-short" },
        { v: "short", label: "Short" },
        { v: "medium", label: "Medium" },
        { v: "long", label: "Long" },
        { v: "xlong", label: "Extra-long" },
        { v: "stupid", label: "Stupid long" },
        { v: "adaptive", label: "Adaptive" },
        { v: "", label: "Unspecified" },
      ],
    },
    {
      kind: "chips",
      key: "phase",
      label: "Phase",
      plural: "phases",
      prefix: true,
      hint: [
        "Phase sets where a filter smears transients in time, through ringing: a trade-off between transient reproduction and spatial accuracy. Linear phase lands all frequencies together for spatial accuracy, but pre-rings, smearing the transient into the time before it occurs. Minimum phase delays higher frequencies relative to lower, marring the sense of space, but has no pre-ringing and so more natural transients. Intermediate phase rings asymmetrically, more after the transient than before.",
      ],
      options: [
        { v: "minimum", label: "Minimum" },
        { v: "intermediate", label: "Intermediate" },
        { v: "linear", label: "Linear" },
        { v: "", label: "Unspecified" },
      ],
    },
    {
      kind: "seg",
      label: "1x sources",
      hint: [
        'This feature determines whether to show or hide filters capable of reducing ultrasonic noise (containing "hires" or "mp3/mqa" in the name) in the 1x filter dropdowns. At 1x rates, this only benefits lossy material like MP3 and MQA; lossless material contains no ultrasonic content to attenuate. Selecting "Lossless" hides these filters; "Lossy" shows them only.',
      ],
      rows: [
        {
          key: "lossy",
          stage: "1x",
          showStage: false,
          aria: "1x sources",
          options: [
            { v: "both", label: "Both" },
            { v: "lossless", label: "Lossless", tag: "Lossless" },
            { v: "lossy", label: "Lossy", tag: "Lossy" },
          ],
        },
      ],
    },
    {
      kind: "checks",
      label: "Rate change",
      prefix: true,
      hint: [
        "Rate-limited filters are only capable of output rates that are whole-number or factor-of-two multiples of the source rate. For example, given a 48kHz source file, such filters cannot resample to 44.1kHz-family output rates: they are restricted to PCM output at 2x48k, 4x48k, 8x48k, … and DSD at 64x48k, 128x48k, 256x48k, … If your output mode is SDM and your DAC doesn't support 48kHz-family DSD rates, these filters will produce no output when fed 48k-family source files; hide them with the checkbox above.",
      ],
      items: [
        { key: "hideLimited", label: "Hide output rate-limited filters", tag: "No rate-limited" },
        { key: "downsafe", label: "Show only filters that support downsampling", tag: "Downsampling" },
        {
          key: "odd",
          label: "Show only filters that support resampling uncommon source rates (e.g., 32kHz)",
          tag: "Uncommon rates",
        },
      ],
    },
    {
      kind: "toggle",
      key: "fav",
      label: "Favorites",
      tag: "♥ Favorites",
      hint: ["Show only the filters and modulators you favorited"],
      chip: { label: "♥ Favorites" },
    },
  ],
];

// Shaper lists: modulators narrow by their DSD rate floor (the rows' own badge, v1 modulatorTier from
// shapers.json min_rate_hz) and by favorites; dithers by their rate marker (`≥4x`, from the plain-names leaf: the rate each
// dither is documented as designed for). `list` = the list a facet narrows (its chips count that list). No hint copy exists for either.
export const MOD_BAR = [
  [
    {
      kind: "chips",
      key: "modTier",
      list: "modulators",
      label: "Minimum rate",
      plural: "rates",
      options: [
        { v: "256+", label: "256+" },
        { v: "512+", label: "512+" },
        { v: "1024+", label: "1024+" },
      ],
    },
  ],
];
export const DITHER_BAR = [
  [
    {
      kind: "chips",
      key: "ditherRate",
      list: "dithers",
      label: "Minimum rate",
      plural: "rates",
      options: [
        { v: "≥2x", label: "≥2x" },
        { v: "≥4x", label: "≥4x" },
        { v: "≥8x", label: "≥8x" },
        { v: "≥16x", label: "≥16x" },
      ],
    },
  ],
];

/** Every facet, by cluster (lib/narrow.js flattens it). Favorites is shared: one switch, both kinds (v1). */
export const COLUMNS = [...BAR, ...MOD_BAR, ...DITHER_BAR];

/** Default combine modes for facets with AND/OR. */
export const DEFAULT_MODES = { genreMode: "or", focusMode: "and" };

/** Mock state for this mockup: three narrowings active. */
export const INITIAL = { quality: 3, apod1x: "only", lossy: "lossless" };

/** Mock favorites (engine names). */
export const FAVORITES = {
  filters: ["poly-sinc-ext2", "poly-sinc-gauss-long", "poly-sinc-gauss-hires-lp"],
  modulators: ["AMSDM7EC 512+fs", "ASDM7EC-fast 512+fs"],
};
