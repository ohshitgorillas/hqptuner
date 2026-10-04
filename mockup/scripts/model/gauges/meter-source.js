// Source meter mock source: a deterministic music-like signal, free of the DOM. Each spectrogram column and spectrum
// bin it yields is a pure function of the track column and the source, so a test reads one from a table.

const PEAK_CEIL_DB = -0.6; // highest peak the mock source reaches
const DSD_NOISE_HZ = 12000; // where a DSD source's modulator noise starts to climb
//: The mock track's four chords (MIDI notes), 2.4 s each.
const CHORDS = [
  [45, 57, 61, 64],
  [50, 57, 62, 66],
  [43, 55, 59, 62],
  [48, 55, 60, 64],
];

/**
 * What the mock source holds: where its content ends and whether a DSD modulator's noise rides over the top of the band.
 *
 * @typedef {object} MockSource
 * @property {number} brick       Hz
 * @property {boolean} [dsdNoise]
 */

/**
 * The mock source as a feed of spectrogram columns: the column period and each spectrogram row's frequency.
 *
 * @typedef {MockSource & { perCol: number, rowHz: ArrayLike<number> }} MockFeed
 */

/**
 * What sounds in one mock column.
 *
 * @typedef {object} MockVoice
 * @property {number[]} notes  Hz
 * @property {number[]} dyn    dB under full level, one per note
 * @property {number} hatDb    dB under the hat's level
 * @property {boolean} kick
 * @property {boolean} hat
 * @property {number} env      dB, applied to everything
 */

/**
 * One mock column: its voice, its apodizing events, and its spectrogram rows (dBFS) for L, then R, then Sum.
 *
 * @typedef {MockVoice & { idx: number, apod: number, db: Float32Array }} MockColumn
 */

/**
 * Power in dB.
 *
 * @param {number} p
 */
const dB = (p) => 10 * Math.log10(p);

/**
 * Linear power at `f` for one channel of one mock column, its envelope applied: a falling noise bed, each note's
 * harmonics up to 97% of the brick wall (panned apart between the channels), a kick in the bass, a hat in the treble,
 * the brick wall's cut, the 16-bit floor and, from DSD, modulator noise climbing toward the top of the band.
 *
 * @param {MockVoice} c
 * @param {number} f      Hz
 * @param {number} ch     channel index
 * @param {MockSource} src
 * @returns {number}
 */
export function power(c, f, ch, src) {
  const brick = src.brick;
  let p = 10 ** ((-56 - 5 * Math.log2(Math.max(f, 60) / 250) - (f < 60 ? 12 * Math.log2(60 / f) : 0)) / 10);
  c.notes.forEach((f0, n) => {
    const pan = (n + ch) % 2 ? 0 : -2.5;
    for (let k = 1; k <= 14; k++) {
      const fk = f0 * k;
      if (fk > brick * 0.97) break;
      const d = Math.log2(f / fk);
      if (d > 0.15 || d < -0.15) continue;
      p +=
        10 ** ((-20 - 6.5 * Math.log2(k) + pan - (n === 0 ? 0 : 4) - c.dyn[n]) / 10) *
        Math.exp(-0.5 * (d / 0.035) ** 2);
    }
  });
  if (c.kick && f < 180) p += 10 ** (-12 / 10) * Math.exp(-0.5 * (Math.log2(f / 60) / 0.6) ** 2);
  if (c.hat && f > 3000) p += 10 ** ((-58 - c.hatDb - 3 * Math.log2(f / 8000) ** 2) / 10);
  if (f > brick) p *= 10 ** (-Math.min(110, (f - brick) * (brick > 30000 ? 0.012 : 0.09)) / 10);
  p += 10 ** (-112 / 10);
  if (src.dsdNoise && f > DSD_NOISE_HZ) p += 10 ** ((-118 + ((f - DSD_NOISE_HZ) / 10000) * 62) / 10);
  return p * 10 ** (c.env / 10);
}

/**
 * The mock column's power scatter at one row or bin of one channel, as a linear factor within ±3 dB.
 *
 * @param {{ idx: number }} c
 * @param {number} i   row or bin
 * @param {number} ch  channel index (the spectrum draws its own)
 * @returns {number}
 */
export const jitter = (c, i, ch) => 10 ** ((hash(c.idx * 211 + i, 1 + ch) - 0.5) * 0.6);

/**
 * Apodizing events in one mock column: clustered in the opening 90 columns, rare afterwards.
 *
 * @param {number} idx
 * @returns {number}
 */
function apodEvents(idx) {
  if (idx < 90) return hash(idx, 3) < 0.12 ? 1 + Math.floor(hash(idx, 4) * 2) : 0;
  return hash(idx, 5) < 0.0015 ? 1 : 0;
}

/**
 * The mock column at track column `idx`: a chord changing every 2.4 s with its dynamics, a kick every fifth column and
 * a hat two before it, the envelope, the apodizing events, and its spectrogram rows.
 *
 * @param {number} idx
 * @param {MockFeed} feed
 * @returns {MockColumn}
 */
export function mockColumn(idx, feed) {
  const t = idx * feed.perCol;
  const chord = CHORDS[Math.floor(t / 2.4) % 4];
  const rows = feed.rowHz.length;
  /** @type {MockColumn} */
  const c = {
    idx,
    notes: chord.map((m) => 440 * 2 ** ((m - 69) / 12)),
    dyn: chord.map((_, n) => 6 * hash(Math.floor(t / 0.6), 20 + n) + (t % 2.4) * 2.5),
    hatDb: 10 * hash(idx, 9),
    kick: idx % 5 === 0,
    hat: idx % 5 === 3,
    env: 3 * Math.sin(t * 0.37) + 1.5 * Math.sin(t * 1.9) + (hash(idx, 7) - 0.5) * 2,
    apod: apodEvents(idx),
    db: new Float32Array(rows * 3),
  };
  for (let y = 0; y < rows; y++) {
    const [l, r] = [0, 1].map((ch) => power(c, feed.rowHz[y], ch, feed) * jitter(c, y, ch));
    c.db[y] = dB(l);
    c.db[rows + y] = dB(r);
    c.db[2 * rows + y] = dB((l + r) / 2);
  }
  return c;
}

/**
 * One mock column's spectrum, dBFS per bin, for one channel or the power average of the two.
 *
 * @param {MockColumn} c
 * @param {ArrayLike<number>} binHz
 * @param {string} channel  'sum' or a channel index
 * @param {MockSource} src
 * @returns {Float64Array}
 */
export function binLevels(c, binHz, channel, src) {
  return Float64Array.from(binHz, (f, i) => {
    const p = channel === "sum" ? (power(c, f, 0, src) + power(c, f, 1, src)) / 2 : power(c, f, Number(channel), src);
    return dB(p * jitter(c, i, 5));
  });
}

/**
 * Deterministic hash of two integers to [0, 1): the mock source's only randomness.
 *
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function hash(a, b) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Where a channel's level is heading for one mock column: RMS rides the column's envelope, the peak sits a crest
 * factor above it (redrawn every 60 ms, lifted on a kick) and never past the ceiling.
 *
 * @param {{ idx: number, env: number, kick: boolean }} c  the mock column
 * @param {number} ch                                      channel index
 * @param {number} now                                     ms
 * @returns {{ rms: number, peak: number }}
 */
export function levelTarget(c, ch, now) {
  const rms = -21 + c.env + (ch ? -1.3 : 0) + (hash(c.idx, 11 + ch) - 0.5) * 1.5;
  const pk = rms + 8 + hash(c.idx * 3 + Math.floor(now / 60), 13 + ch) * 5 + (c.kick ? 3 : 0);
  return { rms, peak: Math.min(PEAK_CEIL_DB, pk) };
}
