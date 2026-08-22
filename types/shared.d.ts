// Shapes that cross module boundaries, declared once.
//
// jsconfig's `include` covers types/**/*.d.ts and this file has no top-level
// import/export, so every name here is ambient — a .js module refers to
// `OptionItem` in a JSDoc tag without importing anything. Shapes used by a
// single module stay as a local @typedef in that module; a shape earns a place
// here by appearing in three or more files, where per-file @typedefs would
// otherwise drift into three incompatible spellings of the same object.
//
// Every field below was read off the producer, not inferred from a consumer's
// destructuring — a consumer only proves which fields it touches, never which
// fields exist or whether they are optional.

// One selectable option as the option stores emit it.
//
// Producers: store/options.js enumOptions() and optionsFor(). Both construct
// all four fields unconditionally, so none is optional — `disabled: false` and
// `reason: ""` are written out rather than left off. grayShapersByRate() then
// spreads an option and overwrites disabled/reason, preserving the shape.
//
// `value` is a union because the two producers disagree honestly: a live enum
// option carries the LIST INDEX as a number (the 4321 setters write the index,
// not the enum id — docs/protocol.md §4), while a /config form option carries
// the form's own string value.
interface OptionItem {
  value: string | number;
  label: string;
  disabled: boolean;
  reason: string;
}

// A bare option as the schema catalog and the /config form fields spell it.
//
// NOT an OptionItem and not interchangeable with one: the literal lists in
// store/schema.js (MODES, ENGAGE_BYPASS, ON_OFF, BACKENDS) carry value+label
// only, and so do the `options` arrays inside a /config form field. The store's
// producers are what add `disabled`/`reason`, mapping SchemaOption -> OptionItem
// on the way out. Typing the schema's lists as OptionItem would report a missing
// `disabled` on every entry that has always been correct.
interface SchemaOption {
  value: string | number;
  label: string;
}

// One option in an `askChoices` prompt (store/ask.js).
//
// Distinct from OptionItem despite the overlap: a choice is CHECKABLE and has
// no `reason`. Producer is matrix/ProfileCard.js buildPresetOptions(), the sole
// call site, which builds all four fields from preset names — hence `value:
// string` rather than the OptionItem union.
interface ChoiceOption {
  value: string;
  label: string;
  checked: boolean;
  disabled: boolean;
}

// One plotted curve for PlotFrame (components/plots.js).
//
// `points` is a list of [frequency, value] PAIRS, not {f, db} objects —
// PlotFrame's `poly` destructures each entry positionally as `([f, d])`.
// `y2: true` routes the trace through the optional second (phase) axis instead
// of the dB scale; absent means the dB scale. `dy` is a label nudge in user
// units, present only where two labels would collide.
interface PlotTrace {
  points: [number, number][];
  kind: string;
  label: string;
  y2?: boolean;
  dy?: number;
}

// One draggable dot overlaid on a plot (components/plots.js `handles`).
//
// `f`/`db` are the position in data space. `kind` and `active` are read with
// `|| ""` and a ternary respectively, so both are genuinely optional.
interface PlotHandle {
  f: number;
  db: number;
  kind?: string;
  active?: boolean;
}

// The envelope the snapshot-serving read endpoints wrap their payload in
// (lib/api.js header). health/metadata/pending answer with their payload
// directly and are NOT enveloped — do not apply this type to them.
//
// Note this is documentation with teeth rather than enforcement: the fetch
// helpers return `r.json()`, which is `any`, so a caller opts in by annotating
// the value it unwraps.
interface ApiEnvelope<T> {
  stale: boolean;
  loaded_at: number;
  data: T;
}

// What a schema entry's grayWhen/adviseWhen predicate is handed.
//
// Built at store/graying.js:18 as `{ mode: modeName.value, effective }`.
// `effective(key)` resolves a control's rendered value — live override, else
// staged edit, else baseline — and returns undefined for an unknown key or a
// control with no value on either side. Booleans are in the union because a
// /config baseline arrives as a real bool while its staged counterpart is the
// string "1"/"0" (store/resolve.js:186).
interface GrayCtx {
  mode: string;
  effective: (key: string) => string | number | boolean | undefined;
}

// One control's entry in the schema catalog (store/schema.js).
//
// Field meanings are specified in that file's header block, which is the
// authority; the optionality below follows it. Only label/group/widget/lane are
// present on every entry — the lane-specific fields (stateField/liveKey/arg for
// live, field for http) are by definition present on one lane's entries only,
// so they cannot be required.
//
// Deliberately NOT narrowed to string-literal unions (e.g. lane: 'live'|'http')
// even though the header enumerates the legal values. Under `noImplicitAny`
// alone, tsc does not narrow the object literal's inferred property types to
// those unions, so declaring them here would report conflicts that describe the
// declaration rather than the code. That belongs to the strictNullChecks/strict
// stages, with the schema literal typed via satisfies — not to this one.
interface SchemaField {
  label: string;
  group: string;
  widget: string;
  lane: string;

  // live lane
  stateField?: string;
  liveKey?: string;
  arg?: string;

  // http lane
  field?: string;
  endpoint?: string;
  formField?: string;

  // options
  optionsFrom?: string;
  enumKey?: string;
  options?: SchemaOption[];

  // graying and advice
  grayWhen?: (ctx: GrayCtx) => string;
  adviseWhen?: (ctx: GrayCtx) => string;
  deviceGray?: string;
  quietGray?: boolean;
  inlineGray?: boolean;
  // A DISCRIMINATOR, not a flag: "pcm" | "sdm", handed to grayShapersByRate() as
  // its `kind` argument (schema.js:526,565 -> Field.js:159).
  rateGray?: string;
  // A DISCRIMINATOR, not a flag: "filters" | "dithers" | "modulators" |
  // "sdm_conversion" | "sdm_integrator", handed to store/plainnames.js
  // decorateOptions()/plainClosedLabel() as its `kind` argument.
  plainNames?: string;
  // Silences the per-option manual prose while the Option style pref is
  // Simplified, on a control whose Simplified rows already carry that wording
  // (components/binder.js quietDesc). The raw engine name and the control's own
  // tooltip are not affected.
  plainQuiet?: boolean;

  // numeric widgets
  def?: string | number | boolean;
  // Track mapping, not a multiplier: the only value in the catalog is "log"
  // (store/schema.js:770,789,828,844), which controls/index.js:262 tests for by
  // string equality to put the range track in log space.
  scale?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  ticks?: number[];

  // presentation and prose
  sublabel?: string;
  note?: string;
  desc?: string;
  hint?: string;
  hoverNote?: boolean;
  anchor?: string;
  wide?: boolean;
  span?: boolean;
  // Opposite of `wide`, and a DISCRIMINATOR rather than a flag: "sm" | "md",
  // naming the small fixed width a dropdown takes instead of the global select
  // width, sized to the longest label its option list carries.
  compact?: string;
  // Also a DISCRIMINATOR rather than a flag: "1x" | "nx", naming which filter
  // family to narrow the option list to (schema.js:500,513,539,552). Passed as
  // the `kind` argument of narrowOptions()/narrowCount() at Field.js:158,177 and
  // live.js:483,496 — which is why declaring it boolean broke live.js on its own.
  narrow?: string;
  // Another DISCRIMINATOR: "filters" | "modulators", naming which favorites set
  // this dropdown's stars write into. The four filter dropdowns share one set;
  // the modulator dropdown has its own, and its list is narrowed by that set
  // alone (binder.js favFor, Field.js/chains.js favOnlyModulators).
  favKind?: string;
  // Render the number control as a slider (schema.js:685 and 7 more -> Field.js:302).
  slider?: boolean;

  // behavior flags
  bool?: boolean;
  appliesLive?: boolean;
  fileTruth?: boolean;
  rescan?: boolean;
}
