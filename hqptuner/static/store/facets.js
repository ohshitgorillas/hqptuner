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
import { enums, metadata } from "./state.js";

function quality(desc) {
  const m = /(\d+)\s*\/\s*5/.exec(desc || "");
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
function normRatio(s) {
  const t = (s || "")
    .toLowerCase()
    .replace(/ˣ/g, "x") // 2ˣ -> 2x
    .replace(/\^/g, "") // 2^x -> 2x
    .replace(/\s*up\s*$/, "")
    .trim();
  if (!t) return null;
  if (t === "1:1") return "1:1";
  if (t.startsWith("int")) return "integer";
  if (t.startsWith("2x")) return "2x";
  if (t.startsWith("any")) return "any";
  return t;
}
function ratioLive(desc) {
  const m = TAIL_RE.exec(desc || "");
  return m ? normRatio(m[1]) : null;
}

// Ratio is the one chain-dependent facet. mqa/mp3 upsample-only on PCM but
// any-ratio on SDM, so they carry ratioPcm/ratioSdm and are resolved per chain
// at check time (narrowing.js). Every other filter has a single ratio: the live
// wire value (active-mode authority) if present, else the static class.
function ratioFacet(liveDesc, s) {
  if (s && (s.ratio_pcm != null || s.ratio_sdm != null)) {
    return { ratio: null, ratioPcm: s.ratio_pcm ?? null, ratioSdm: s.ratio_sdm ?? null };
  }
  const r = ratioLive(liveDesc) ?? (s ? (s.ratio ?? null) : null);
  return { ratio: r, ratioPcm: null, ratioSdm: null };
}

function phase(name) {
  const n = name || "";
  if (/-ip\b|-ip$/.test(n)) return "intermediate";
  if (/-mp\b|-mp$|min/i.test(n)) return "minimum";
  if (/-lp\b|-lp$/.test(n)) return "linear";
  return "";
}

// "hi-res" filters — the poly-sinc *-hires-* variants and the mqa/mp3 filters
// (manual §4.6: "for HiRes content … also suitable for lossy compression such
// as MP3 or MQA"). Detected by NAME, the same authority phase/length read from:
// the class is baked into the engine's own naming, not a manual editorial bit,
// so it survives on both the live-enum and static-overlay paths. Drives the two
// hi-res narrow toggles (hidden from 1x by default, the sole survivors of the
// Nx "hi-res only" toggle — store/narrowing.js).
function isHires(name) {
  return /hires|mqa|mp3/i.test(name || "");
}

// length — short / medium / long / xlong. Letter-coded names don't carry a
// readable token, so they get explicit entries grounded in the manual /
// filters.json tap counts: the sinc letter series (S=4096×ratio, M/Mx/MG/MGa =
// million taps and "variants of poly-sinc-ext2-xla / gauss-xl(a)" → xlong,
// L=131070×, Ls=4096×, Lm/Lh=16384×, Ll=65536×), the million-tap closed-forms
// (xlong), gauss-halfband-s ("Short … Gaussian"), the polynomial interpolators
// and minringFIR ("ringing between polynomial and poly-sinc-short"). Everything
// else classifies by name token — xl/xla ("8-times-longer" variants) are xlong;
// short / long / hb-s / hb-xs / hb-l as written — with the -2s two-stage suffix
// stripped first; unmarked names read as medium.
const LENGTH_OVERRIDES = {
  "sinc-S": "short",
  "sinc-M": "xlong",
  "sinc-Mx": "xlong",
  "sinc-MG": "xlong",
  "sinc-MGa": "xlong",
  "sinc-L": "long",
  "sinc-Ls": "short",
  "sinc-Lm": "medium",
  "sinc-Ll": "long",
  "sinc-Lh": "medium",
  "closed-form-M": "xlong",
  "closed-form-16M": "xlong",
  "poly-sinc-gauss-halfband-s": "short",
  "polynomial-1": "short",
  "polynomial-2": "short",
  "minringFIR-lp": "short",
  "minringFIR-mp": "short",
};
function length(name) {
  const n = name || "";
  const base = n.endsWith("-2s") ? n.slice(0, -3) : n;
  if (LENGTH_OVERRIDES[base]) return LENGTH_OVERRIDES[base];
  if (/short|shrt|-hb-xs$|-hb-s$/.test(base)) return "short";
  if (/-xla?$/.test(base)) return "xlong";
  if (/long|-hb-l$/.test(base)) return "long";
  return "medium";
}

// Y / ½ / N from the manual → the same shape the live arg bits produce: full sets
// apodizing, half sets apodizingHalf, none sets neither.
function apodFromStatic(a) {
  return { apodizing: a === "full", apodizingHalf: a === "half" };
}

// Upsample-only ("up" in the manual's ratio column, e.g. "Integer up") — the
// live wire ratio may carry it; else the static overlay's banked bit.
function upsampleLive(desc) {
  const m = TAIL_RE.exec(desc || "");
  return m ? /\bup\b/i.test(m[1]) : false;
}
function upsampleFlag(desc, s) {
  return upsampleLive(desc) || !!(s && s.upsample_only);
}

// A live enum item: quality/focus/ratio parsed from the wire description, apod
// from arg bits, genre from the backend-merged static overlay.
function liveFacet(it, s) {
  return {
    genre: (it.static && it.static.genre) || (s && s.genre) || [],
    quality: quality(it.description),
    focus: focus(it.description),
    phase: phase(it.name),
    length: length(it.name),
    hires: isHires(it.name),
    apodizing: !!it.apodizing,
    apodizingHalf: (Number(it.arg) & 2) === 2,
    upsampleOnly: upsampleFlag(it.description, s),
    ...ratioFacet(it.description, s),
  };
}

// A static-only entry (a filter absent from the live enum — the inactive mode's
// exclusive set). All facets from the manual overlay; phase/length from name.
function staticFacet(name, s) {
  const apod = apodFromStatic(s.apodizing);
  return {
    genre: s.genre || [],
    quality: s.quality ?? null,
    focus: s.focus || [],
    phase: phase(name),
    length: length(name),
    hires: isHires(name),
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
  const map = {};
  for (const it of live) map[it.name] = liveFacet(it, staticDb[it.name]);
  for (const [name, s] of Object.entries(staticDb)) {
    if (!map[name]) map[name] = staticFacet(name, s);
  }
  return map;
});
