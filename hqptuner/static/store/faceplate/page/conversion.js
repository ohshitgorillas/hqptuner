// The page's Resampling and Shaping sections, read off what runs: the running chain's fields, each one's engine name at
// the index the engine reports, whether this track's path runs it, its plain-name breakdown and the prose of the option
// it runs. One field is open per section: the running filter, or the one the user opened while the same playback
// holds; a plate tall enough opens both filters. A pick is written live by the option's enum ID, and the drawer's own
// select follows through the live overlay.

import { signal, computed, effect } from "@preact/signals";
import { describe, optionProse } from "../../prose.js";
import { plainEntry, decorateOptions } from "../../plainnames.js";
import { chainControls } from "../../live/chains.js";
import { CHAINS, sourceIsNx } from "../../live/derive.js";
import { loadedChain } from "../../live/rates.js";
import { writeLive } from "../../live/write.js";
import { playbackPath, runningChain } from "../path.js";
import { plate } from "../view.js";
import { bothRows, fieldRuns, openOn, sectionRows } from "../../../model/shell/conversion.js";

/**
 * @typedef {"resampling" | "shaping"} SectionId
 * @typedef {"1x" | "nx" | "sh"} FieldId
 * @typedef {import("../../../model/shell/conversion.js").Play} Play
 * @typedef {import("../../live/derive.js").MenuOption} MenuOption
 *
 * @typedef {object} ConvField  one chain field as the page shows it
 * @property {FieldId} id
 * @property {string} key       its catalog key, which the option list opens on
 * @property {"1x" | "nx"} stage  the stage narrowing reads
 * @property {string} value     the engine name running in it
 * @property {boolean} idle     this track's path does not run it
 * @property {string} fam       the running option's plain family, "" where the overlay has none
 * @property {string | null} variant  its plain variant, null where it has none
 * @property {string} leaf      its name as the option style prints it: the plain row text, or the engine name
 * @property {string} prose     its manual prose that reads inline, "" where the overlay has none
 * @property {string[]} more    its manual paragraphs held behind "see more", none where nothing is held
 *
 * @typedef {object} ConvSection
 * @property {FieldId[]} open   the open fields, in order
 * @property {ConvField[]} fields
 *
 * @typedef {{ resampling: ConvSection, shaping: ConvSection }} ConvSections
 */

/** Each chain control's field id, in the order derive.js lists a chain's controls. @type {FieldId[]} */
const IDS = ["1x", "nx", "sh"];

/** The fields each section holds. @type {Record<SectionId, FieldId[]>} */
const SECTION_FIELDS = { resampling: ["1x", "nx"], shaping: ["sh"] };

/** What plays now, as the lifted conversion model reads it. @returns {Play} */
const playNow = () => ({ run: runningChain(), path: playbackPath(), stage: sourceIsNx() ? "nx" : "1x" });

/** The playback a field the user opened belongs to: a new chain, path or source side reopens on what runs. */
const playKey = computed(() => {
  const p = playNow();
  return `${p.run}|${p.path}|${p.stage}`;
});

/** The field the user opened in each section for the playback that holds, or none. */
const opened = signal(/** @type {Partial<Record<SectionId, FieldId>>} */ ({}));

effect(() => {
  void playKey.value;
  opened.value = {};
});

/**
 * The running option's plain breakdown: family and variant whatever the option style, the name as the style prints it.
 *
 * @param {string} kind  the overlay section
 * @param {string} name  the engine name
 * @returns {{ fam: string, variant: string | null, leaf: string }}
 */
export function plainOf(kind, name) {
  const e = kind ? plainEntry(kind, name) : null;
  const shown = kind ? decorateOptions([{ label: name }], kind)[0] : { label: name };
  return {
    fam: e?.family ?? "",
    variant: e?.variant ?? null,
    leaf: "display" in shown ? String(shown.display) : name,
  };
}

/**
 * One chain control as the page shows it.
 *
 * @param {ReturnType<typeof chainControls>[number]} c
 * @param {FieldId} id
 * @param {Play} play
 * @returns {ConvField}
 */
function fieldOf(c, id, play) {
  const opt = c.optionsRaw.find((o) => String(o.value) === String(c.value));
  const value = opt ? opt.label : "";
  const words = opt ? optionProse(c.entry, opt, describe(c.entry, c.key)) : { text: "", more: [] };
  return {
    id,
    key: c.key,
    stage: id === "nx" ? "nx" : "1x",
    value,
    idle: !fieldRuns(play, play.run, id),
    ...plainOf(c.entry.plainNames || "", value),
    prose: words.text,
    more: words.more,
  };
}

/**
 * A section's open fields: both filters where the plate holds them, else the one the user opened or the running one.
 *
 * @param {SectionId} section
 * @param {Play} play
 * @returns {FieldId[]}
 */
function openIn(section, play) {
  const chain = play.run;
  if (section === "resampling" && plate.value.both) {
    return bothRows([chain], chain).fields.map((f) => /** @type {FieldId} */ (f.k));
  }
  const field = opened.value[section] ?? (section === "shaping" ? "sh" : openOn(play, chain).rs.field);
  return sectionRows([chain], { chain, field }, SECTION_FIELDS[section])
    .filter((r) => r.kind === "field")
    .map((r) => /** @type {FieldId} */ (r.k));
}

/**
 * The page's Resampling and Shaping sections for what runs: each one's open fields and its fields.
 *
 * @returns {ConvSections}
 */
export function conversionSections() {
  const play = playNow();
  const fields = chainControls(play.run, loadedChain() || null).map((c, i) => fieldOf(c, IDS[i], play));
  /** @param {SectionId} s @returns {ConvSection} */
  const section = (s) => ({ open: openIn(s, play), fields: fields.filter((f) => SECTION_FIELDS[s].includes(f.id)) });
  return { resampling: section("resampling"), shaping: section("shaping") };
}

/**
 * A folded line's tap: its field opens in its section for as long as this playback holds.
 *
 * @param {SectionId} section
 * @param {FieldId} field
 */
export function openField(section, field) {
  opened.value = { ...opened.value, [section]: field };
}

/**
 * A pick from a field's option list: the option's enum ID written live to the field's chain control. A key no chain
 * holds, or a name its list does not carry, writes nothing.
 *
 * @param {string} key    the field's catalog key
 * @param {string} value  the engine name picked
 * @returns {Promise<void>}
 */
export async function pickOption(key, value) {
  const chain = Object.keys(CHAINS).find((ch) => CHAINS[ch].some((c) => c.key === key));
  if (!chain) return;
  const c = chainControls(chain, loadedChain() || null).find((x) => x.key === key);
  const opt = c?.optionsRaw.find((o) => o.label === value);
  if (c && opt) await writeLive(c.field, String(opt.value));
}
