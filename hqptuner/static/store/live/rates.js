// --- the rate card -----------------------------------------------------------
// The Output tab's rate box, as it is there: a PCM column and an SDM column with
// a hairline between them, the one the running mode cannot use grayed (schema
// grayWhen isSdm/isPcm), both reading the manual's rate prose on hover.
//
// Both sides write a LIMIT, and neither one picks a base family. The menus carry
// a tier as its 48k member and mean the tier; the browser sends that value
// unchanged; the backend puts it in the config limit slot, and the engine picks
// the member matching the playing source, per track, under auto_family. Nothing
// here reads what is playing.
//
// It is its own module because the tier/member arithmetic is still what the menu
// is grayed by: which tiers the engine is currently enumerating.

import { engineState } from "../signals.js";
import { schema, TWIN_44K } from "../schema.js";
import { runningValue } from "../resolve.js";
import { grayRatesByDevice } from "../narrow/devicecaps.js";
import { items, modeValue, rateValue } from "./derive.js";

/** @typedef {import("./derive.js").MenuOption} MenuOption */

/** @type {Record<string, string>} */
const RATE_KEY = { pcm: "pcm_rate", sdm: "sdm_rate" };
// No PCM rate the engine offers reaches DSD64, so the lowest SDM rate separates
// the two families outright — no rate is ambiguous between them.
const SDM_FLOOR = 2822400;

const rateFamily = (/** @type {string | number} */ rate) => (Number(rate) >= SDM_FLOOR ? "sdm" : "pcm");

// --- tiers and their members --------------------------------------------------
// Every tier has a 44.1k and a 48k member (DSD512 is 22579200 or 24576000). The
// menus carry the 48k one and mean the TIER, not that frequency, and that is the
// value that goes on the wire: the backend writes it to the limit slot and the
// engine resolves the base family per track under auto_family. Neither this
// module nor the write path looks at what is playing. Whether the DAC may use a
// 48k DSD base at all remains the user's setting (alsa_anydsd / net_anydsd).
// The tier pairing itself lives beside the rate tables it pairs (store/schema.js).

// The rates the engine is enumerating right now, as a set of Hz strings.
/** @returns {Set<string>} */
const offeredRates = () => new Set(items("rates").map((o) => String(o.rate)));

// Which member of a tier the engine is holding, '' for neither — the tier is
// reachable when EITHER member is enumerated, because either one reaches it. A
// device doing DSD in one base family only enumerates one member of every DSD
// tier, and judging the tier by a single member grays tiers that device plays
// perfectly well. Only the menu's gray marks read this; nothing sends the member.
/**
 * @param {string} tier
 * @param {Set<string>} offered
 * @returns {string}
 */
function offeredMember(tier, offered) {
  if (offered.has(tier)) return tier;
  const twin = String(TWIN_44K[tier] || "");
  return twin && offered.has(twin) ? twin : "";
}

// A tier the engine is not currently offering is listed and grayed with the
// reason, never dropped: a tier silently missing from the menu reads as one this
// build doesn't support, rather than one the engine isn't offering right now.
// Offered is judged on the TIER — either member answers for it, because either
// one reaches it — never on the single member we would have preferred to send.
// The enumeration says only that it is absent, never why — so the reason says
// that and no more.
const UNOFFERED = "unavailable";

// One column's list before device graying: the running family's is judged against
// GetRates, the dormant one is offered whole. Both arrive as MenuOption[] — the
// schema's bare table picks up no gray mark, which the type already allows.
/**
 * @param {string} key
 * @param {boolean} enabled
 * @returns {MenuOption[]}
 */
function columnOptions(key, enabled) {
  return enabled ? rateOptions(key) : schema[key].options || [];
}

/**
 * @param {string} key
 * @returns {MenuOption[]}
 */
function rateOptions(key) {
  const offered = offeredRates();
  // A list carrying nothing but auto is the engine declining to enumerate rather
  // than the engine offering nothing. What fills the list is the transport as
  // well as the mode (manual p.18 §4.4), so a backend whose device is not open
  // reports exactly that — verified live on 6.0.4 against an idle network backend.
  // Graying every tier against a list like that is what made the whole menu
  // unselectable, so a list with nothing in it to judge by judges nothing.
  // `options` is optional on SchemaField; every rate entry in the catalog has one.
  const options = schema[key].options || [];
  if (offered.size <= 1) return options;
  return options.map((o) =>
    offeredMember(String(o.value), offered) ? o : { ...o, disabled: true, reason: UNOFFERED },
  );
}

// The chain the engine has LOADED, "" for none — the one family question the
// engine alone can answer, and the only one a caller reading the mode from
// elsewhere still has to ask it (store/alerts/shaperfit.js).
/** The family of the chain the engine has loaded, "" when it has none. */
export function loadedChain() {
  return (engineState.value || {}).active_chain || "";
}

// Which family the engine is running. The loaded chain answers it outright; with
// no chain loaded the mode does, and in auto mode before playback nothing does —
// there neither column is grayed, because the engine takes a rate for either.
/** Which family the engine will produce output in: the loaded chain, else the mode, else null for both. */
function liveFamily() {
  const chain = loadedChain();
  if (chain) return chain;
  const mode = modeValue();
  return mode === "pcm" || mode === "sdm" ? mode : null;
}

// --- the rate columns in auto ------------------------------------------------
// In `[source]` the engine chooses the output rate itself, once per stream, from
// the source rate, the filter's conversion capability and the configured limit
// (manual §4.4) — and it accepts no rate on the wire while it is doing that.
// Probe-verified on 6.0.4 mid-playback (`scripts/probes/probe_rate_source_effect.py`):
// requests for rates BELOW what was playing leave `State.rate` at `"0"` and
// `Status.active_rate` unmoved. The limit is the only
// thing that governs there and the Control API has no command for it
// (protocol.md §6), so LIVE has nothing to write in auto and says so, rather
// than taking an edit the engine would drop. The column still shows the limit,
// which is what the engine is choosing under.
//
// The reason is hover-only, on both this page and the tabs (`quietGray`,
// store/schema.js): a caption under the pair is a line of prose the Rate card
// carries in one mode and not the other, which grows the card and stretches the
// Mode switch beside it. It says what the gray means and stops there — the user
// knows where the rate lives, and a control that lectures about the restart on
// the Output tab is prose nobody needed.
const AUTO_RATE_REASON = "The engine selects the rate in Auto mode.";

// --- what the dormant column shows -------------------------------------------
// State reports one rate, the running family's, so the moment the engine changes
// family the other column has nothing of its own left to read — and the engine
// has genuinely forgotten it, because SetMode clears the pin outright
// (probe-verified on 6.0.4, scripts/probes/probe_mode_rate_pin.py). What survives the switch is the
// backend's own per-family memory of what LIVE pinned, which it re-asserts on the
// engine when that family comes round again and reports in BOTH limit fields of
// the running config (routing.live_overrides). runningValue reads exactly that
// overlay, so the dormant column here and the Output tab's column are one number
// from one source rather than two guesses that drift apart.
/**
 * One family's rate column — its current tier, its option list, and whether the control
 * is editable at all.
 * @param {string} family "pcm" | "sdm" — the column, not the running chain
 */
export function rateColumn(family) {
  const live = liveFamily();
  const enabled = live === null || live === family;
  const auto = modeValue() === "auto";
  const key = RATE_KEY[family];
  const tier = rateValue();
  const mine = tier !== "" && rateFamily(tier) === family;
  const configured = runningValue(key);
  return {
    field: "rate",
    key,
    entry: schema[key],
    // Disabled in auto and only there, both columns alike (AUTO_RATE_REASON):
    // the engine takes no rate at all while it is following the source, so an
    // enabled control would promise something nothing downstream can deliver.
    // Keyed on the MODE, never on the loaded chain — in auto a chain is loaded
    // the whole time and takes filter and shaper edits live, which is why the
    // cards beside this one stay editable. Under an explicit mode NEITHER column
    // is disabled, on the same terms as the dormant chain card
    // (components/live/View.js): a rate writes that family's own config limit slot
    // (lanes/live/chain.RATE_LIMIT_FIELD), so setting up the SDM side while PCM
    // plays is an ordinary thing to do here.
    disabled: auto,
    reason: auto ? AUTO_RATE_REASON : "",
    // Which tiers the engine is offering is read off the rates enumeration, so
    // this column's gray marks are as stale as any other list during a
    // re-enumerating write.
    enumBacked: true,
    // The engine's own pin when it is reporting one for this family, the running
    // config's limit otherwise — which already carries the remembered pin, held
    // or applied (routing.live_overrides). With no pin at all the limit is what
    // the engine selects, so a column nothing has touched names the same tier the
    // Output tab does instead of reporting the empty slot as "Auto".
    value: mine ? tier : configured,
    // One menu for both columns — the tab's own table, in the tab's own order,
    // whole either way. The running family's column grays what the engine is not
    // offering; the dormant one is offered whole, because GetRates answers for
    // the loaded family only and has no list to judge the other against.
    // Device capability grays BOTH columns, running and dormant alike: what the
    // hardware can carry does not depend on which chain is loaded, so the column
    // GetRates has nothing to say about still knows its own device's ceiling.
    options: grayRatesByDevice(columnOptions(key, enabled), family),
  };
}
