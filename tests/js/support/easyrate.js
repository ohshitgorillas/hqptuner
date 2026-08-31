// The rate-side seams of the Easy Mode tile harness, and the engine enumeration
// they are stated in: which backend the daemon's form says is active, what that
// backend's DSD base is, and the ratio class the engine gives each filter.
//
// Split out of tests/js/support/easytiles.js rather than added to it: that
// harness is at its file-length gate, and this is the half a rate case drives.
// It is handed the filter VOCABULARY rather than owning one — which filters
// exist is the curated table's business, and easytiles.js is what asks the table
// (see its header).
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { formFields } from "./tabform.js";

/**
 * The engine knobs a case may seed beside the filter fields: which output
 * backend is active, and that backend's own `any_dsd` switch — "0" for a backend
 * pinned to the 44.1 kHz DSD base, "1" when the 48 kHz family is available too.
 * The daemon carries one switch per backend and spells them `alsa_anydsd` and
 * `net_anydsd` (hqplayerd-readme.txt), so a case names the backend and the
 * harness writes the switch that backend reads.
 *
 * The defaults are the state that constrains nothing: an ALSA backend whose
 * switch says the 48 kHz family is available, which is what every case written
 * before these seams existed was implicitly running against.
 *
 * @typedef {{ backend?: string, anydsd?: string }} Engine
 */

/**
 * The enumerated filters a lane is driven against: every name the curated table
 * can write, the engine id each carries, and the "none" every list starts from.
 *
 * @typedef {{ names: string[], idOf: (name: string) => string, none: { value: string, label: string } }} Vocab
 */

/**
 * The backend row and both `any_dsd` rows, always present the way the daemon's
 * form always carries all three. The named backend gets the seeded switch value
 * and the other gets "1", so a lane reading the WRONG backend's switch reads a
 * value that disagrees rather than one that coincides. A backend owning neither
 * switch — "combo" is one — gets the seeded value on both, which makes a case
 * about such a backend the sharp one: the switches say 44.1 kHz base and the
 * backend is still not one whose base is pinned.
 *
 * @param {Engine} [engine]
 * @returns {Record<string, string>}
 */
export const engineRows = ({ backend = "alsa", anydsd = "1" } = {}) => {
  const owns = backend === "alsa" || backend === "network";
  return {
    backend,
    alsa_anydsd: !owns || backend === "alsa" ? anydsd : "1",
    net_anydsd: !owns || backend === "network" ? anydsd : "1",
  };
};

/**
 * The /api/config payload: the daemon's form as rows, and the `file` half — the
 * settings as the daemon's own XML holds them. Both halves carry the same
 * backend and switches, because a payload whose halves disagree is one the
 * daemon never serves.
 *
 * @param {Record<string, unknown>} form
 * @param {string} mode
 * @param {Engine} [engine]
 */
export const configPayload = (form, mode, engine) => ({
  fields: formFields(/** @type {never} */ (form)),
  file: { mode, ...engineRows(engine) },
  active: "",
  profiles: null,
});

// The tails the engine spells a filter's ratio class with, by the class name a
// case asks for. The class is stated at the end of a `<FiltersItem/>`
// description, after the chain glyph — `⥣` on the SDM chain, `⥮` on the PCM one
// (docs/protocol.md §4, the format tests/js/store/narrowing-rate.test.js drives
// narrowing with). A filter the enumeration describes with no tail, or does not
// describe at all, carries no ratio class: that is the absence a case wanting
// "the enumeration says nothing" seeds.
const TAIL = { "2x": "2^x", integer: "Int", any: "Any" };

/** One SDM item's description. The head is a stand-in; what a case reads is the tail. */
const describedAs = (/** @type {string} */ cls) => `4/5 ⥣ ${TAIL[/** @type {keyof typeof TAIL} */ (cls)]}`;

/**
 * The engine's own enumeration in one reported mode, each filter item carrying a
 * `description` when the case classed that filter's name and none otherwise.
 *
 * @param {Vocab} vocab
 * @param {string} modeName
 * @param {Record<string, string>} [ratios] ratio class by filter NAME
 */
export const enumerations = (vocab, modeName, ratios = {}) => ({
  filters: [
    { index: "0", value: vocab.none.value, name: vocab.none.label },
    ...vocab.names.map((name, i) => ({
      index: String(i + 1),
      value: vocab.idOf(name),
      name,
      ...(ratios[name] === undefined ? {} : { description: describedAs(ratios[name]) }),
    })),
  ],
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: modeName },
});

/**
 * What the Output tab's lane finds in `enums`. The tab is driven off the daemon's
 * form, but a filter's ratio class is stated in the running engine's enumeration
 * and the app polls that on every page, so a case handing `ratios` — even an
 * EMPTY map, an enumeration describing no filter's class at all — gets that
 * enumeration seeded, and a case handing none gets the bare tab the other suites
 * drive, with nothing enumerated. The reported mode name is the engine's own
 * word for our output mode (`[SOURCE]` for auto, `SDM` for DSD out,
 * store/live/derive.js), so form and enumeration say the same thing twice rather
 * than a pair the daemon never serves together.
 *
 * @param {Vocab} vocab
 * @param {string} mode
 * @param {Record<string, string> | null} ratios
 */
export const tabEnums = (vocab, mode, ratios) =>
  ratios === null ? null : enumerations(vocab, { pcm: "PCM", sdm: "SDM", auto: "[SOURCE]" }[mode] || "PCM", ratios);

/**
 * What State reports for one chain end: the LIST INDEX of the filter the engine
 * has loaded there (docs/protocol.md §4, never the id), or the "0" of a chain
 * end holding nothing.
 *
 * @param {Vocab} vocab
 * @param {string} [name]
 */
export const loaded = (vocab, name) => (name === undefined ? "0" : String(vocab.names.indexOf(name) + 1));
