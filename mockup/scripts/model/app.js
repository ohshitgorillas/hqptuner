// Faceplate composition model: the decisions the page's wiring (scripts/app/) paints, free of the DOM. The engine row's
// gauge and buffers, the page's top section, what a playback path shows, the mock alerts a pick raises and the
// Setting Switcher's target change each come back as a value; the caller writes it into the page.

/** Zone seams [bad|warn, warn|ok]. @typedef {[number, number]} Seams */

/**
 * The speed gauge's needle end and figure.
 *
 * @typedef {object} GaugeReading
 * @property {string} x2    needle end x, one decimal
 * @property {string} y2    needle end y, one decimal
 * @property {string} text  the figure
 * @property {string} zone  bad | warn | ok, '' with nothing playing
 */

/**
 * What a scenario plays, as far as these decisions read it.
 *
 * @typedef {object} Scene
 * @property {string} id
 * @property {boolean} playing
 * @property {string} [family]   pcm | dsd
 * @property {string} [source]   the rail's Source value
 * @property {string} [stage]    the rate stage, '1x' | 'nx'
 * @property {number} [nyquist]  Hz
 */

/** @typedef {{ meterIdle: string, meterDsd: string }} MeterCopy */

/**
 * The page's top section: the Matrix section at the top, folded to its header line, and whether the spectrum shows.
 *
 * @typedef {object} FillLayout
 * @property {boolean} profile    the Matrix section has the top
 * @property {boolean} fold       the Matrix section sits on one line above the spectrum
 * @property {boolean} show       the spectrum shows
 * @property {string | null} why  'off' while hidden, else the no-stream line, null for a running meter
 * @property {string} key         what the page meter shows: it remounts only when this changes
 */

/** @typedef {{ speed: number, in: number, out: number }} EngineFigures */
/** @typedef {{ v: number, zone: string }} BufferReading */

/**
 * What a playback path shows on the engine row and the rail.
 *
 * @typedef {object} PathView
 * @property {number | null} speed        process speed ×, null with nothing in the engine table
 * @property {BufferReading[]} buffers    input, output
 * @property {string} source              the rail's Source value
 * @property {boolean} direct             Direct SDM: every stage but Speakers leaves the path
 * @property {number | null} tier         the rate dial's playing tier, null while idle
 */

/**
 * @typedef {object} PathTables
 * @property {Record<string, EngineFigures | null>} engine
 * @property {{ buffer: Seams }} zones
 * @property {Record<string, { tier: number }>} out
 */

/** @typedef {{ kind: string, sev: string, text: string }} Alert */

/**
 * The alert lines, as data/alerts.js writes them.
 *
 * @typedef {object} AlertCopy
 * @property {string} credentials
 * @property {(speed: number) => string} speedCrit
 * @property {(clips: number) => string} clip
 * @property {(events: number, filter: string) => string} apod
 * @property {(shaper: string, rate: string) => string} shaperSdm
 * @property {(shaper: string, rate: string, floor: string) => string} shaperPcm
 * @property {string} roonIdle
 * @property {(foldKhz: number, rateKhz: number) => string} junk20k
 */

/**
 * The page at the moment alerts are raised.
 *
 * @typedef {object} RaiseNow
 * @property {string} p                  the playback path
 * @property {string} run                the running chain, pcm | sdm
 * @property {{ pcm: { sh: string }, sdm: { sh: string } }} st   each chain's shaper
 * @property {Set<string>} picked        the mock alert kinds picked
 * @property {string} rf                 the rail's running filter
 * @property {Scene} scene
 */

/** @typedef {{ v: string, f?: { apod?: boolean | null } }} ListOption */
/** @typedef {{ speed: number, clips: number }} MockFigures */

/**
 * @typedef {object} RaiseTables
 * @property {Record<string, ListOption[]>} lists
 * @property {AlertCopy} copy
 * @property {MockFigures} fig
 */

/** The engine row's speed and clip lamp after a raise. @typedef {{ speed: number | null, clip: boolean }} EngineRow */

/** A switcher slot's face, kept while the Output mode target borrows the slots. @typedef {{ l: string, v: string, on: boolean }} SlotFace */

/**
 * What a Setting Switcher target change does: the plate's switcher mode, whether the slots are borrowed (stash), handed
 * back (restore) or left alone (none), and on restore the slot to light.
 *
 * @typedef {object} SwitcherChange
 * @property {string} sw     the plate's data-sw: volume | ''
 * @property {string} step   stash | restore | none
 * @property {number} lit    restore: the slot index to light
 */

/**
 * Red | amber | green by the seams; null (nothing playing) is no zone.
 *
 * @param {number | null | undefined} v
 * @param {Seams} seams
 * @returns {string}
 */
export const zone = (v, [lo, hi]) => (v == null ? '' : v < lo ? 'bad' : v < hi ? 'warn' : 'ok');

/**
 * The process speed gauge: × on a log scale, 1× at the warn | ok seam; nothing playing rests the needle at the left
 * stop. The figure takes the zone its needle sits in.
 *
 * @param {number | null | undefined} v
 * @param {Seams} seams
 * @returns {GaugeReading}
 */
export function gaugeReading(v, seams) {
  const th = (v == null ? 180 : Math.max(0, Math.min(180, 107.2 - 74.7 * Math.log2(v)))) * Math.PI / 180;
  return {
    x2: (55 + 44 * Math.cos(th)).toFixed(1),
    y2: (54 - 44 * Math.sin(th)).toFixed(1),
    text: v == null ? '—' : v.toFixed(2) + '×',
    zone: zone(v, seams),
  };
}

/**
 * The no-stream line a source meter shows instead of running: nothing playing, or DSD with the matrix engine bypassed.
 * Null when the meter runs.
 *
 * @param {Scene} scene
 * @param {boolean} mxApplied
 * @param {MeterCopy} copy
 * @returns {string | null}
 */
export function noStream(scene, mxApplied, copy) {
  if (!scene.playing) return copy.meterIdle;
  return scene.family === 'dsd' && !mxApplied ? copy.meterDsd : null;
}

/**
 * Every station's record of a profile name, in station order.
 *
 * @template R
 * @param {Record<string, Record<string, R>>} profiles
 * @param {string} name
 * @returns {R[]}
 */
export function profileRecords(profiles, name) {
  return Object.values(profiles).map((st) => st[name]).filter(Boolean);
}

/**
 * The page's top section from the Layout preference (auto | profile | spectrum) and the matrix engine as applied.
 * Bypassed, there is no profile: the spectrum takes the top and nothing folds.
 *
 * @param {boolean} mxApplied
 * @param {string} pref
 * @param {Scene} scene
 * @param {MeterCopy} copy
 * @returns {FillLayout}
 */
export function fillLayout(mxApplied, pref, scene, copy) {
  const profile = mxApplied && pref === 'profile';
  const show = !profile;
  const why = show ? noStream(scene, mxApplied, copy) : 'off';
  return { profile, fold: mxApplied && pref === 'auto', show, why, key: `${why}|${scene.id}` };
}

/**
 * What a playback path shows: the engine row's figures, the rail's Source value, whether Direct takes the stages out,
 * and the tier the rate dial plays.
 *
 * @param {string} p
 * @param {string} run
 * @param {Scene} scene
 * @param {PathTables} tables
 * @returns {PathView}
 */
export function pathView(p, run, scene, { engine, zones, out }) {
  const e = engine[p];
  const direct = p === 'direct';
  const buffers = e ? [e.in, e.out].map((v) => ({ v, zone: zone(v, zones.buffer) })) : [0, 0].map((v) => ({ v, zone: zone(null, zones.buffer) }));
  return {
    speed: e?.speed ?? null,
    buffers,
    source: scene.playing ? scene.source ?? '' : '—',
    direct,
    tier: p === 'idle' ? null : out[direct ? 'direct' : run].tier,
  };
}

/**
 * The mock alerts the picks raise where v1's would fire. Apodizing fires only where a filter runs (not a DSD → SDM path)
 * and only for a running filter its list marks non-apodizing; the shaper fits are judged in the chain that will produce
 * output, playing or not; junk advice is for Nx PCM content only.
 *
 * @param {RaiseNow} now
 * @param {RaiseTables} tables
 * @returns {Alert[]}
 */
export function raisedAlerts({ p, run, st, picked, rf, scene }, { lists, copy, fig }) {
  const playing = p !== 'idle';
  const rfApod = lists[run + 'Filters']?.find((o) => o.v === rf)?.f?.apod;
  /** @type {[boolean, string, string, () => string][]} */
  const rules = [
    [true, 'credentials', 'crit', () => copy.credentials],
    [playing, 'speed', 'crit', () => copy.speedCrit(fig.speed)],
    [playing, 'clip', 'warn', () => copy.clip(fig.clips)],
    [playing && !['sdm-sdm', 'direct'].includes(p) && rfApod === null, 'apod', 'warn', () => copy.apod(12, rf)],
    [run === 'sdm', 'shaperSdm', 'crit', () => copy.shaperSdm(st.sdm.sh, 'DSD256')],
    [run === 'pcm', 'shaperPcm', 'warn', () => copy.shaperPcm(st.pcm.sh, '2x', '4x')],
    [playing, 'roon', 'warn', () => copy.roonIdle],
    [playing && scene.family === 'pcm' && scene.stage === 'nx', 'junk', 'advice',
      () => copy.junk20k(21.6, Math.round(Number(scene.nyquist) / 500))],
  ];
  return rules.filter(([when, kind]) => when && picked.has(kind)).map(([, kind, sev, text]) => ({ kind, sev, text: text() }));
}

/**
 * The engine row reads what the raised alerts read (mock figures), else the path's own.
 *
 * @param {Alert[]} alerts
 * @param {string} p
 * @param {Record<string, EngineFigures | null>} engine
 * @param {MockFigures} fig
 * @returns {EngineRow}
 */
export function engineRow(alerts, p, engine, fig) {
  const speed = alerts.some((a) => a.kind === 'speed') ? fig.speed : engine[p]?.speed ?? null;
  return { speed, clip: alerts.some((a) => a.kind === 'clip') };
}

/**
 * A Setting Switcher target change. The Volume target puts the switcher in volume; the Output mode target borrows the
 * slots once, and any other target hands them back, relighting the slot that was live (the first when none was).
 *
 * @param {string} target                           the target picked
 * @param {SlotFace[] | null} stash                 the slot faces the Output mode target keeps, null while not borrowed
 * @param {{ mode: string, volume: string }} targets the Output mode and Volume targets' values
 * @returns {SwitcherChange}
 */
export function switcherChange(target, stash, targets) {
  const on = target === targets.mode;
  const step = on && !stash ? 'stash' : !on && stash ? 'restore' : 'none';
  return { sw: target === targets.volume ? 'volume' : '', step, lit: stash ? Math.max(0, stash.findIndex((x) => x.on)) : 0 };
}
