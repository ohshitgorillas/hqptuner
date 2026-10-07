// The narrowing console's facets, one console per list kind, each facet a window in the list's head that opens its
// controls with its hint. Copy is the mockup's (mockup/scripts/data/lists/narrow-facets.js), verbatim, and the hints are
// v1's own (components/narrowbar/Facets.js, narrowbar/Stages.js, the settings.json apodizing tooltip).
//
// Facet kinds:
//   chips   multi-select chips; the state is the picks. `combine` adds an AND / OR mode (state key `<key>Mode`).
//   toggle  one switch; the state is a boolean (Favorites, drawn as a plain switch with no popover).
//   seg     segmented rows, each its own state key, its first option the default. A row's `stage` narrows that
//           stage's list only, and its counts are that stage's.
//   checks  checkboxes, a boolean state per item.
// `id` names the facet's window; `hint` is paragraphs, each a string or [bold lead-in, rest], `prefix` opening the first
// with the hints' own lead-in.

/** @typedef {{ v: string | number, label: string }} FacetOption */
/** @typedef {{ key: string, aria: string, stage?: "1x" | "nx", showStage?: boolean, options: FacetOption[] }} FacetRow */
/** @typedef {{ key: string, label: string, tag: string }} FacetItem */
/**
 * One facet of a console.
 *
 * @typedef {object} BarFacet
 * @property {string} id
 * @property {"chips" | "toggle" | "seg" | "checks"} kind
 * @property {string} label
 * @property {string} [key]
 * @property {boolean} [apod]
 * @property {boolean} [combine]
 * @property {boolean} [prefix]
 * @property {(string | [string, string])[]} [hint]
 * @property {FacetRow[]} [rows]
 * @property {FacetOption[]} [options]
 * @property {FacetItem[]} [items]
 */

const APOD_HINT =
  'The need for an apodizing filter is based on detected errors that originate from the recording ADC or mastering tools. Apodizing filters should be used at least when the "Apod" counter increments to higher than 10 during any single track. There is no harm in using an apodizing filter for content that doesn\'t need one, but there is harm in using non-apodizing filters for content that would need one.';

/** @type {BarFacet} */
const FAVORITES = {
  id: "fav",
  kind: "toggle",
  key: "fav",
  label: "Favorites",
  hint: ["Show only the filters and modulators you favorited"],
};

/** The filter lists' console, in order. @type {BarFacet[]} */
const FILTER_FACETS = [
  {
    id: "quality",
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
          { v: 3, label: "≥ 3/5" },
          { v: 4, label: "≥ 4/5" },
          { v: 5, label: "5/5" },
        ],
      },
    ],
  },
  {
    id: "genre",
    kind: "chips",
    key: "genre",
    label: "Genre",
    combine: true,
    options: [
      { v: "pop", label: "Pop & rock" },
      { v: "jazz", label: "Jazz & blues" },
      { v: "classical", label: "Classical" },
      { v: "electronic", label: "Electronic" },
      { v: "any", label: "All genres" },
    ],
  },
  {
    id: "focus",
    kind: "chips",
    key: "focus",
    label: "Focus",
    combine: true,
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
    id: "apod",
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
          { v: "only", label: "Only" },
          { v: "half", label: "+½" },
        ],
      },
      {
        key: "apodNx",
        stage: "nx",
        aria: "Apodizing Nx",
        options: [
          { v: "all", label: "All" },
          { v: "only", label: "Only" },
          { v: "half", label: "+½" },
        ],
      },
    ],
  },
  {
    id: "length",
    kind: "chips",
    key: "length",
    label: "Length",
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
    id: "phase",
    kind: "chips",
    key: "phase",
    label: "Phase",
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
    id: "lossy",
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
          { v: "lossless", label: "Lossless" },
          { v: "lossy", label: "Lossy" },
        ],
      },
    ],
  },
  {
    id: "rate",
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
  FAVORITES,
];

/** The modulator list's console: the rate floor its rows' badge names, then Favorites (one switch, both kinds). */
/** @type {BarFacet[]} */
const MODULATOR_FACETS = [
  {
    id: "modTier",
    kind: "chips",
    key: "modTier",
    label: "Minimum rate",
    options: [
      { v: "256+", label: "256+" },
      { v: "512+", label: "512+" },
      { v: "1024+", label: "1024+" },
    ],
  },
  FAVORITES,
];

/** The dither list's console: the rate marker its plain leaf carries. @type {BarFacet[]} */
const DITHER_FACETS = [
  {
    id: "ditherRate",
    kind: "chips",
    key: "ditherRate",
    label: "Minimum rate",
    options: [
      { v: "≥2x", label: "≥2x" },
      { v: "≥4x", label: "≥4x" },
      { v: "≥8x", label: "≥8x" },
      { v: "≥16x", label: "≥16x" },
    ],
  },
];

/**
 * The id of the popover a facet's window opens.
 *
 * @param {BarFacet} f
 */
export const popId = (f) => `facet-${f.id}`;

/** Each list kind's console. @type {Record<import("../../../store/faceplate/lists/open.js").ListKind, BarFacet[]>} */
export const CONSOLES = { filters: FILTER_FACETS, modulators: MODULATOR_FACETS, dithers: DITHER_FACETS, dsd: [] };

/**
 * The tip's facet labels: each chips facet's option labels by value, the words the console itself prints.
 *
 * @type {import("../../../model/shell/option-list.js").Labels}
 */
export const FACET_LABELS = Object.fromEntries(
  FILTER_FACETS.flatMap((f) =>
    f.kind === "chips" && f.key && f.options
      ? [[f.key, Object.fromEntries(f.options.map((o) => [String(o.v), o.label]))]]
      : [],
  ),
);
