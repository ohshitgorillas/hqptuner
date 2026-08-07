// --- the rate card -----------------------------------------------------------
// The Output tab's rate box, as it is there: a PCM column and an SDM column with
// a hairline between them, the one the running mode cannot use grayed (schema
// grayWhen isSdm/isPcm), both reading the manual's rate prose on hover.
//
// The two sides write different slots. The tab writes the LIMIT
// (defaults_samplerate / defaults_bitrate, landing at the next restart), which
// the engine then follows in the source's own base family. LIVE writes SetRate,
// an exact rate that ignores both the limit and the source's family. Same tier
// either way — what differs is only that the live one has to name a member of it.
//
// It is its own module because the tier/member arithmetic is the lane's largest
// single idea and the only reader the write path needs: `wireRate` is what turns
// a menu tier into the rate that goes on the wire.

import { engineState, engineStatus } from "../signals.js";
import { schema, TWIN_44K } from "../schema.js";
import { runningValue } from "../resolve.js";
import { grayRatesByDevice } from "../devicecaps.js";
import { items, modeValue, rateValue } from "./derive.js";

/** @typedef {import("./derive.js").MenuOption} MenuOption */

/** @type {Record<string, string>} */
const RATE_KEY = { pcm: "pcm_rate", sdm: "sdm_rate" };
// No PCM rate the engine offers reaches DSD64, so the lowest SDM rate separates
// the two families outright — no rate is ambiguous between them.
const SDM_FLOOR = 2822400;

const rateFamily = (/** @type {string | number} */ rate) => (Number(rate) >= SDM_FLOOR ? "sdm" : "pcm");

// --- base family -------------------------------------------------------------
// Every tier has a 44.1k and a 48k member (DSD512 is 22579200 or 24576000). The
// menus carry the 48k one and mean the TIER, not that frequency. A config write
// cannot choose between the two — it has no source — which is exactly why the
// tab writes the limit slot and lets the engine decide. LIVE can choose, because
// the engine reports what is playing, so a tier picked here resolves to that
// source's own member and 44.1k material is never sent out at a 48k base rate.
// Whether the DAC may use a 48k DSD base at all remains the user's setting
// (alsa_anydsd / net_anydsd); this only declines to change it behind their back.
//
// Verified live on 6.0.4 (44.1 kHz source, limit DSD512): no pin -> 22579200;
// pinned 12288000 -> 12288000; pinned 49152000 -> 49152000 (over the limit).
// The tier pairing itself lives beside the rate tables it pairs (store/schema.js).
const BASE_44K = 44100;

// 44.1k when the playing source and 44100 divide either way — multiples cover
// 88.2/176.4/352.8 and every DSD rate, and the other direction covers the
// sub-44.1k members of the same family (22050, 11025), which are 44.1k material
// as much as 88.2 is. With nothing playing there is no source to follow, so the
// menus' own 48k base stands, which is what a config write would have used anyway.
function sourceIs44k() {
  const st = engineStatus.value || {};
  const source = Number((st.metadata || {}).samplerate) || Number((st.status || {}).active_rate) || 0;
  return source > 0 && (source % BASE_44K === 0 || BASE_44K % source === 0);
}

// The tier's member in the source's own base family — what LIVE would send if
// the engine offered both.
const forSource = (/** @type {string} */ tier) => (sourceIs44k() && TWIN_44K[tier] ? TWIN_44K[tier] : tier);

// The tier's other member, '' when the menu value has no twin.
const otherMember = (/** @type {string} */ tier, /** @type {string} */ member) =>
  member === tier ? String(TWIN_44K[tier] || "") : tier;

// The rates the engine is enumerating right now, as a set of Hz strings.
/** @returns {Set<string>} */
const offeredRates = () => new Set(items("rates").map((o) => String(o.rate)));

// Which member of a tier the engine is actually holding, '' for neither. The
// source's own member first — a 44.1k track goes out at a 44.1k base wherever
// there is a choice — and the tier's other member when that is the only one the
// engine lists. A device doing DSD in one base family only enumerates one member
// of every DSD tier, and judging the tier by the member we would have PREFERRED
// grayed tiers that device plays perfectly well (and, on the write path, held a
// pin the engine had no index for: livechain.rate_index_for).
/**
 * @param {string} tier
 * @param {Set<string>} offered
 * @returns {string}
 */
function offeredMember(tier, offered) {
  const mine = forSource(tier);
  if (offered.has(mine)) return mine;
  const other = otherMember(tier, mine);
  return other && offered.has(other) ? other : "";
}

// A menu value as the rate to actually send: the member the engine is holding,
// falling back to the source's own when it holds neither — there is nothing
// better to send, and the lane holds an unpinnable rate rather than dropping it.
/**
 * @param {string} tier
 * @returns {string}
 */
export function wireRate(tier) {
  return offeredMember(tier, offeredRates()) || forSource(tier);
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

// Which family the engine is running. The loaded chain answers it outright; with
// no chain loaded the mode does, and in auto mode before playback nothing does —
// there neither column is grayed, because the engine takes a rate for either.
function liveFamily() {
  const chain = (engineState.value || {}).active_chain;
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
// The caption names the cost outright rather than just refusing: the limit IS
// settable, on the config lane, and that lane pushes `POST /restore` and the
// daemon restarts on it (~5.6 s, `lanes/httplane.py`). A restart is the one
// thing the LIVE page exists not to do, so this is the rare control that sends
// the user to the tabs view — and it says why, so the refusal does not read as
// the setting being unreachable. Confirmed upstream (Jussi, email 2026-07-29; history-ok: upstream attribution, kept by decision):
// the rate limit and family settings are specific to the selected output
// hardware, so a live limit is impossible by design — but an explicit output
// rate can be set on the fly, which is the escape hatch the caption offers.
//
// The tabs' own rate pair grays quietly (`quietGray`, store/schema.js) because
// its reason changes with the mode and would reflow the row. This one does not
// move: it is shown only in auto and says the same thing the whole time.
const AUTO_RATE_REASON =
  "In Auto the engine picks the rate per track, up to this limit. The limit is tied to the output device " +
  "and can never change live — set it on the Output tab (restarts the engine). To pin a rate on the fly, " +
  "switch to PCM or SDM modes.";

// --- what the dormant column shows -------------------------------------------
// State reports one rate, the running family's, so the moment the engine changes
// family the other column has nothing of its own left to read — and the engine
// has genuinely forgotten it, because SetMode clears the pin outright
// (probe-verified on 6.0.4, scripts/probes/probe_mode_rate_pin.py). What survives the switch is the
// backend's own per-family memory of what LIVE pinned, which it re-asserts on the
// engine when that family comes round again and reports in BOTH limit fields of
// the running config (livemap.live_overrides). runningValue reads exactly that
// overlay, so the dormant column here and the Output tab's column are one number
// from one source rather than two guesses that drift apart.
/**
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
    // (components/LiveView.js): a rate for the family the engine is not running
    // is held and lands when that family loads (lanes/livemap.unpinnable_rate),
    // so setting up the SDM side while PCM plays is an ordinary thing to do here.
    disabled: auto,
    reason: auto ? AUTO_RATE_REASON : "",
    // Which tiers the engine is offering is read off the rates enumeration, so
    // this column's gray marks are as stale as any other list during a
    // re-enumerating write.
    enumBacked: true,
    // The engine's own pin when it is reporting one for this family, the running
    // config's limit otherwise — which already carries the remembered pin, held
    // or applied (livemap.live_overrides). With no pin at all the limit is what
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
