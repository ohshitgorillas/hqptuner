// Musical note frequencies — equal temperament, A4 = 440 Hz.
//
// The point of the note table (PRIMER "evaluate at *musical* frequencies"): a
// fault that lives on one register is invisible on a uniform log grid. "E2 is
// fine, A2 is not" explains a symptom; "there is a trough at 168 Hz" does not.

import { valueAt } from "./curve.js";

/** @typedef {import("./curve.js").CurveLike} CurveLike */

/**
 * One note in a range, with the frequency equal temperament puts it at.
 *
 * @typedef {{ midi: number, name: string, hz: number }} Note
 */

/**
 * Which notes to tabulate, and at which harmonics. `harmonics` absent or empty
 * means the fundamental alone.
 *
 * @typedef {{ from: string, to: string, harmonics?: number[] }} NoteSpec
 */

/**
 * One note's reading at one harmonic. `db` is null where the harmonic lands
 * outside the curve's grid — kept rather than dropped, so a row never silently
 * disappears from the table.
 *
 * @typedef {{ n: number, hz: number, db: number | null }} HarmonicReading
 */

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** @type {Record<string, number>} */
const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d+)$/;

/**
 * "G#4" / "Ab4" / "G4" -> MIDI number. Throws on anything else.
 *
 * @param {string} name
 * @returns {number}
 */
export function noteToMidi(name) {
  const m = NOTE_RE.exec(String(name).trim());
  if (!m) throw new Error(`note: cannot parse "${name}" (expected e.g. G4, A#3, Eb6)`);
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PITCH_CLASS[m[1].toUpperCase()] + accidental;
}

/**
 * @param {number} midi
 * @returns {string}
 */
export function midiToName(midi) {
  return `${SHARP[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * @param {number} midi
 * @returns {number}
 */
export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Inclusive semitone range between two note names, low to high.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Note[]}
 */
export function noteRange(from, to) {
  const [a, b] = [noteToMidi(from), noteToMidi(to)];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return Array.from({ length: hi - lo + 1 }, (_, i) => ({
    midi: lo + i,
    name: midiToName(lo + i),
    hz: midiToHz(lo + i),
  }));
}

/**
 * Note/harmonic table against one curve. Harmonics above the grid's top are
 * kept with `db: null` rather than dropped — a missing row reads as an omission.
 *
 * @param {CurveLike} curve
 * @param {NoteSpec | null | undefined} spec
 * @returns {(Note & { harmonics: HarmonicReading[] })[] | null}
 */
export function noteTable(curve, spec) {
  if (!spec) return null;
  const harmonics = spec.harmonics && spec.harmonics.length ? spec.harmonics : [1];
  return noteRange(spec.from, spec.to).map((note) => ({
    ...note,
    harmonics: harmonics.map((n) => {
      const hz = note.hz * n;
      const inBand = hz >= curve.freqs[0] && hz <= curve.freqs[curve.freqs.length - 1];
      return { n, hz, db: inBand ? valueAt(curve, hz) : null };
    }),
  }));
}

/**
 * Per-note, per-harmonic dB deltas between two curves over the same note spec.
 *
 * @param {CurveLike} before
 * @param {CurveLike} after
 * @param {NoteSpec | null | undefined} spec
 * @returns {(Note & { harmonics: { n: number, hz: number, before: number | null, after: number | null, delta: number | null }[] })[] | null}
 */
export function noteDeltas(before, after, spec) {
  if (!spec) return null;
  // Neither table is null: `noteTable` returns null only for a null spec, and
  // the guard above has already ruled that out.
  const tables = /** @type {NonNullable<ReturnType<typeof noteTable>>[]} */ ([
    noteTable(before, spec),
    noteTable(after, spec),
  ]);
  const [b, a] = tables;
  return b.map((note, i) => ({
    ...note,
    harmonics: note.harmonics.map((h, j) => {
      const other = a[i].harmonics[j];
      // Both sides are tested, not just `h.db`: an out-of-band `other.db` is
      // null, and `null - h.db` would coerce to `-h.db` — a fabricated delta
      // where the honest answer is "not measured".
      const delta = h.db === null || other.db === null ? null : other.db - h.db;
      return { n: h.n, hz: h.hz, before: h.db, after: other.db, delta };
    }),
  }));
}
