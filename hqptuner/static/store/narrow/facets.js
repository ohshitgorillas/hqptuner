// Per-filter facet map for the narrowing UI. LIVE-FIRST, STATIC-FALLBACK: the
// running engine's enumeration is authority for the filters of the mode it is
// IN, and its FiltersItem descriptions carry quality/focus/ratio live (arg bit 0
// = apodizing). But HQPTuner shows both the PCM and SDM chains persistently,
// while the engine only ever enumerates the ACTIVE mode's filters — so the
// inactive mode's exclusive filters are absent from the live enum and would have
// no facets at all (the mode-scoping narrowing bug). The static filters.json
// overlay (quality/focus/apodizing/ratio, transcribed from the manual) fills
// exactly those gaps. Static is name-keyed and NEVER overrides live: a future
// HQPlayer that renames/adds filters is still covered live for the active mode,
// and a stale static entry simply never matches. (architecture §2 volatility.)
import { computed } from "@preact/signals";
import { enums, metadata } from "../signals.js";

/**
 * @typedef {object} StaticFilterEntry
 *   One filter's manual-transcribed overlay row (data/filters.json), as the
 *   backend merges it onto a live item and serves it under `metadata.filters`.
 * @property {string[]} [genre]
 * @property {number} [quality]
 * @property {string[]} [focus]
 * @property {string} [apodizing] "full" | "half" | anything else = none
 * @property {string} [phase] manual-derived fallback for token-less names
 * @property {string} [ratio]
 * @property {string} [ratio_pcm] mode-split ratio: mqa/mp3 only
 * @property {string} [ratio_sdm]
 * @property {boolean} [upsample_only]
 *
 * @typedef {object} EnumItem
 *   One item of a live enumeration. Every attribute the daemon sends arrives as
 *   a STRING (engine/control.get_all_enumerations -> dict[str, str]); `apodizing`
 *   and `static` are the two fields the backend adds when merging the overlay
 *   (metadata.merge_enumerations).
 * @property {string} index list index — what the Set* setters write
 * @property {string} name
 * @property {string} [value] enum id; absent on RatesItem, which carries `rate`
 * @property {string} [description]
 * @property {string} [arg] bit flags; bit 0 = apodizing, bit 1 = half-apodizing
 * @property {string} [rate] RatesItem only: the rate in Hz
 * @property {boolean} [apodizing] backend-derived from arg bit 0
 * @property {StaticFilterEntry} [static] backend-merged overlay row, null on a miss
 *
 * @typedef {object} FilterFacet
 *   One filter's narrowing record — the union of what the live description
 *   carries and what the static overlay fills in.
 * @property {string[]} genre
 * @property {number|null} quality null when the description carries no "n/5"
 * @property {string[]} focus
 * @property {string} phase "" when the name carries no phase token
 * @property {string} length short | medium | long | xlong, "" when nothing classifies it
 * @property {boolean} hiresFamily
 * @property {boolean} apodizing
 * @property {boolean} apodizingHalf
 * @property {boolean} upsampleOnly
 * @property {string|null} ratio null for the mode-split filters, which use the pair below
 * @property {string|null} ratioPcm
 * @property {string|null} ratioSdm
 */

/**
 * @param {string} [desc]
 * @returns {number|null}
 */
function quality(desc) {
  const m = /\b(\d+)\s*\/\s*5/.exec(desc || "");
  return m ? Number(m[1]) : null;
}

// The glyph separating the facet head from the ratio class DIFFERS BY CHAIN:
// PCM filters (which resample both directions) use ⥮, SDM oversampling filters
// (up-only by nature — you cannot downsample into DSD) use ⥣. Verified
// exhaustively against the captured enumerations: 67/67 PCM ⥮, 77/77 SDM ⥣.
// Matching ⥮ alone silently blanked focus for the 50 SDM filters that carry one,
// and sent ratio/upsample down their static fallback. Any new parse of the
// description tail goes through these two, never a bare glyph literal.
const ARROW = "[⥮⥣]";
const FOCUS_RE = new RegExp(`^\\s*\\d+/5\\s*(.*?)\\s*${ARROW}`);
const TAIL_RE = new RegExp(`${ARROW}\\s*(.+?)\\s*$`);

// "4/5 space, transients ⥮ Any" -> ["space", "transients"]; "1/5 ⥣ Int" -> []
/**
 * @param {string} [desc]
 * @returns {string[]}
 */
function focus(desc) {
  const m = FOCUS_RE.exec(desc || "");
  if (!m || !m[1]) return [];
  return m[1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// The ratio class sits after the arrow in the live description ("… ⥮ Any", "…
// ⥣ Int"). Normalized to the same tokens the static overlay uses: any /
// integer / 2x / 1:1 (the "up" upsample-only qualifier is dropped — it is not a
// ratio class the narrow chip offers).
//
// The engine ABBREVIATES where the manual spells out: the wire says `Int` and
// `2^x`, the static overlay says `integer` and `2x`. Prefix-matching the long
// forms ("integer".startsWith on "int") never fired, so 28 of 67 PCM filters
// normalized to a raw `int`/`2^x` that matches no narrow chip — and because `??`
// only falls back on null, that truthy junk beat the correct static value.
// Match the SHORT form; both spellings then land on the overlay's token.
/**
 * @param {string} [s]
 * @returns {string|null}
 */
function normRatio(s) {
  const raw = (s || "")
    .toLowerCase()
    .replace(/ˣ/g, "x") // 2ˣ -> 2x
    .replace(/\^/g, "") // 2^x -> 2x
    .trim();
  // Drop a trailing "up", as in "2x up". A slice rather than /\s*up$/, which
  // the engine has to retry from every offset in the string.
  const t = raw.endsWith("up") ? raw.slice(0, -2).trimEnd() : raw;
  if (!t) return null;
  if (t === "1:1") return "1:1";
  if (t.startsWith("int")) return "integer";
  if (t.startsWith("2x")) return "2x";
  if (t.startsWith("any")) return "any";
  return t;
}
/**
 * @param {string|null} [desc]
 * @returns {string|null}
 */
function ratioLive(desc) {
  const m = TAIL_RE.exec(desc || "");
  return m ? normRatio(m[1]) : null;
}

// Ratio is the one chain-dependent facet. mqa/mp3 upsample-only on PCM but
// any-ratio on SDM, so they carry ratioPcm/ratioSdm and are resolved per chain
// at check time (narrowing.js). Every other filter has a single ratio: the live
// wire value (active-mode authority) if present, else the static class.
/**
 * @param {string|null} [liveDesc]
 * @param {StaticFilterEntry} [s]
 * @returns {{ ratio: string|null, ratioPcm: string|null, ratioSdm: string|null }}
 */
function ratioFacet(liveDesc, s) {
  if (s && (s.ratio_pcm != null || s.ratio_sdm != null)) {
    return { ratio: null, ratioPcm: s.ratio_pcm ?? null, ratioSdm: s.ratio_sdm ?? null };
  }
  const r = ratioLive(liveDesc) ?? (s ? (s.ratio ?? null) : null);
  return { ratio: r, ratioPcm: null, ratioSdm: null };
}

// Phase: the name token is authority where the engine encodes one (-lp/-mp/-ip);
// token-less names fall back to the static overlay's manual-derived `phase`, and
// filters where the taxonomy doesn't apply (polynomial, none, ASRC) stay "".
// Token check runs first so `minringFIR-lp` reads as linear, not "min…" minimum.
/**
 * @param {string} name
 * @param {StaticFilterEntry} [s]
 * @returns {string}
 */
function phase(name, s) {
  const n = name || "";
  if (/-ip\b/.test(n)) return "intermediate";
  if (/-mp\b/.test(n)) return "minimum";
  if (/-lp\b/.test(n)) return "linear";
  return (s && s.phase) || "";
}

// The hi-res family, detected by NAME — the same authority phase/length read
// from: the class is baked into the engine's own naming, not a manual editorial
// bit, so it survives on both the live-enum and static-overlay paths.
// `hiresFamily` matches hires, mqa or mp3 in the name, and is the set the 1x
// lossy switch groups on.
/**
 * @param {string} name
 * @returns {boolean}
 */
function isHiresFamily(name) {
  return /hires|mqa|mp3/i.test(name || "");
}

// length — short / medium / long / xlong. Most names carry a readable token and
// classify by it: short / medium / long, the xl/xla extra-long variants, the
// hb-xs / hb-s / hb-l halfbands, with the -2s two-stage suffix stripped first.
//
// A letter-coded name carries no token, so it gets an explicit entry only where
// the filter's own description states a length in words: gauss-halfband-s
// ("Short … Gaussian") and hb-m ("Medium … half-band").
//
// The sinc-S / sinc-M / sinc-Mx / sinc-MG / sinc-MGa descriptions each end in a
// "Variant of poly-sinc-ext2-xla" style reference, which names the filter
// family and not the length — Signalyst places sinc-S and sinc-M(x) in the ext2
// family and sinc-MG(a) in the gauss family. So the reference classifies none of
// them. sinc-S is short by its own length letter, the same S/m/l the rest of the
// sinc set uses; the M names carry no length letter and state only a tap count,
// so they read "" like the sinc-L series.
//
// Everything else reads "", the same answer `phase` gives. Tap count is a
// filter SPECIFICATION, so a description stating only a tap multiplier
// (the sinc-L series, the closed-forms) or nothing at all (the polynomial
// interpolators, minringFIR) yields no length rather than a plausible one.
/** @type {Record<string, string>} */
const LENGTH_OVERRIDES = {
  "sinc-S": "short",
  "poly-sinc-gauss-halfband-s": "short",
  "poly-sinc-hb-m": "medium",
};
/**
 * @param {string} name
 * @returns {string}
 */
function length(name) {
  const n = name || "";
  const base = n.endsWith("-2s") ? n.slice(0, -3) : n;
  if (LENGTH_OVERRIDES[base]) return LENGTH_OVERRIDES[base];
  if (/short|shrt|-hb-xs$|-hb-s$/.test(base)) return "short";
  if (/-xla?$/.test(base)) return "xlong";
  if (/(?:long)|(?:-hb-l$)/.test(base)) return "long";
  if (/medium/.test(base)) return "medium";
  return "";
}

// Y / ½ / N from the manual → the same shape the live arg bits produce: full sets
// apodizing, half sets apodizingHalf, none sets neither.
/**
 * @param {string} [a]
 * @returns {{ apodizing: boolean, apodizingHalf: boolean }}
 */
function apodFromStatic(a) {
  return { apodizing: a === "full", apodizingHalf: a === "half" };
}

// Upsample-only ("up" in the manual's ratio column, e.g. "Integer up") — the
// live wire ratio may carry it; else the static overlay's banked bit.
/**
 * @param {string} [desc]
 * @returns {boolean}
 */
function upsampleLive(desc) {
  const m = TAIL_RE.exec(desc || "");
  return m ? /\bup\b/i.test(m[1] || "") : false;
}
/**
 * @param {string} [desc]
 * @param {StaticFilterEntry} [s]
 * @returns {boolean}
 */
function upsampleFlag(desc, s) {
  return upsampleLive(desc) || !!(s && s.upsample_only);
}

// A live enum item: quality/focus/ratio parsed from the wire description, apod
// from arg bits, genre from the backend-merged static overlay.
/**
 * @param {EnumItem} it
 * @param {StaticFilterEntry} [s]
 * @returns {FilterFacet}
 */
function liveFacet(it, s) {
  return {
    genre: (it.static && it.static.genre) || (s && s.genre) || [],
    quality: quality(it.description),
    focus: focus(it.description),
    phase: phase(it.name, it.static || s),
    length: length(it.name),
    hiresFamily: isHiresFamily(it.name),
    apodizing: !!it.apodizing,
    apodizingHalf: (Number(it.arg) & 2) === 2,
    upsampleOnly: upsampleFlag(it.description, s),
    ...ratioFacet(it.description, s),
  };
}

// A static-only entry (a filter absent from the live enum — the inactive mode's
// exclusive set). All facets from the manual overlay; length from name, phase
// from name token with overlay fallback.
/**
 * @param {string} name
 * @param {StaticFilterEntry} s
 * @returns {FilterFacet}
 */
function staticFacet(name, s) {
  const apod = apodFromStatic(s.apodizing);
  return {
    genre: s.genre || [],
    quality: s.quality ?? null,
    focus: s.focus || [],
    phase: phase(name, s),
    length: length(name),
    hiresFamily: isHiresFamily(name),
    apodizing: apod.apodizing,
    apodizingHalf: apod.apodizingHalf,
    upsampleOnly: !!s.upsample_only,
    ...ratioFacet(null, s),
  };
}

// name -> facet record. Union of the live enum (authority, active mode) and the
// static overlay (fallback for the inactive mode's filters).
export const filterFacets = computed(() => {
  const live = (enums.value && enums.value.filters) || [];
  const staticDb = (metadata.value && metadata.value.filters && metadata.value.filters.filters) || {};
  /** @type {Record<string, FilterFacet>} */
  const map = {};
  for (const it of live) map[it.name] = liveFacet(it, staticDb[it.name]);
  for (const [name, s] of Object.entries(staticDb)) {
    if (!map[name]) map[name] = staticFacet(name, s);
  }
  return map;
});
