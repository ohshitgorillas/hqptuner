// Musical note frequencies — equal temperament, A4 = 440 Hz.
//
// The point of the note table (PRIMER "evaluate at *musical* frequencies"): a
// fault that lives on one register is invisible on a uniform log grid. "E2 is
// fine, A2 is not" explains a symptom; "there is a trough at 168 Hz" does not.

import { valueAt } from "./metrics.js";

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d+)$/;

/** "G#4" / "Ab4" / "G4" -> MIDI number. Throws on anything else. */
export function noteToMidi(name) {
  const m = NOTE_RE.exec(String(name).trim());
  if (!m) throw new Error(`note: cannot parse "${name}" (expected e.g. G4, A#3, Eb6)`);
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PITCH_CLASS[m[1].toUpperCase()] + accidental;
}

export function midiToName(midi) {
  return `${SHARP[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Inclusive semitone range between two note names, low to high. */
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

/** Per-note, per-harmonic dB deltas between two curves over the same note spec. */
export function noteDeltas(before, after, spec) {
  if (!spec) return null;
  const [b, a] = [noteTable(before, spec), noteTable(after, spec)];
  return b.map((note, i) => ({
    ...note,
    harmonics: note.harmonics.map((h, j) => {
      const other = a[i].harmonics[j];
      return { n: h.n, hz: h.hz, before: h.db, after: other.db, delta: h.db === null ? null : other.db - h.db };
    }),
  }));
}
