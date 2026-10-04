// DOM-free decisions the Station builder's steps make: which steps a record skips, what the rail and the overview read
// for each part, the Device step's filtered and grouped list, the Rates step's limits and readouts, the Hardware step's
// questions, and the verdict of each mock check. Each takes its tables as arguments, returns a value and leaves its
// arguments as they were.

import { groupDevices } from './output.js';

/** @typedef {{ pcm: number, sdm: number | null }} Limits  rate tier indices; sdm null = no DSD */

/**
 * @typedef {object} Rec  one station's record
 * @property {string} backend          'network' | 'alsa'
 * @property {string[]} listings       every listing picked for the one device
 * @property {string | null | undefined} resolved  the listing that answers, once disambiguated
 * @property {string} ipv6             '' until answered
 * @property {string} v6               the Discovery value
 * @property {string} iface            '' until answered
 * @property {boolean} detected        the 48k-family check has run
 * @property {Limits} limits
 * @property {string} dsd
 * @property {string} dsd48
 * @property {number} bits             0 = Auto
 * @property {number} gaincomp
 * @property {string} volume           '' until answered
 * @property {string} iso
 */

/** @typedef {{ gpu: boolean, ecores: boolean, gpus: string }} Hw  the machine's hardware answers (the fields read here) */

/** @typedef {{ backend: string, listings: number, iface: string, gpu: boolean }} StepContext  what a step's guide and skip read */

/** @typedef {{ id: string, skip?: (x: StepContext) => string }} Step */

/**
 * @typedef {object} Summary  what the rail and the overview read for each part
 * @property {string} name                  '' = not named yet
 * @property {string} backend
 * @property {string | null | undefined} device  the listing that answers: the resolved one, else the only one picked
 * @property {number} listings              how many listings are picked
 * @property {string | null} discovery      the Discovery value once the IPv6 question is answered
 * @property {boolean} resolved
 * @property {string} iface
 * @property {Limits | null} limits         null until Connection is answered
 * @property {number} bits                  0 = Auto
 * @property {number} gain
 * @property {string} volume
 * @property {number} headroom              the Fixed answer's headroom, dB
 * @property {string} cuda                  the CUDA offload Save writes
 * @property {boolean} ecores               Save writes the E-core DSP pool
 */

/** @typedef {{ on: boolean, dead: boolean, locked: boolean }} ListingState */

/** @typedef {import('./output.js').DeviceRow & ListingState} DeviceLine */

/** @typedef {{ group: string, rows: DeviceLine[] }} DeviceLineGroup */

/**
 * @typedef {object} DeviceView  what the Device step shows
 * @property {boolean} bringUp           the NAA bring-up shows in place of the list
 * @property {number} found              how many listings the list offers
 * @property {DeviceLineGroup[]} groups  the list under its group headers
 */

/** @typedef {{ family: string, unavailable?: boolean }} Tier */

/** @typedef {{ pcm: number, sdm: number | null, dsd: string, dsd48: string }} Fixed  what a connection fixes */

/** @typedef {{ v: string, fixed?: Fixed }} Iface */

/** @typedef {'unanswered' | 'detect' | 'checking' | 'ready'} RatesPhase */

/**
 * @template {Tier} T
 * @typedef {object} RateView  the Rates step's dial and readouts
 * @property {boolean} noDsd                 the record carries no DSD
 * @property {(T & { unavailable: boolean })[]} tiers  every tier, unavailable where the connection cannot carry it
 * @property {{ pcm: number, sdm: number }} dial  where the dial's two hands sit
 * @property {boolean} dsd48                 the 48kHz DSD readout reads Yes
 */

/**
 * @typedef {object} HardwareView  which of the Hardware step's questions and readouts show
 * @property {boolean} gpu           the GPU questions
 * @property {boolean} twoCards      the card indices, the CUDA devices paragraph and readout
 * @property {boolean} power         the GPU power line
 * @property {boolean} ecoresManual  the E-core paragraph
 */

/** @typedef {{ ok: boolean, v6: string }} Ipv6Verdict */

/** @typedef {{ ok: boolean, resolved: string | null | undefined }} UsbVerdict */

/**
 * What a step's guide and skip read from the record and the machine.
 *
 * @param {Rec} rec
 * @param {Hw} hw
 * @returns {StepContext}
 */
export function stepContext(rec, hw) {
  return { backend: rec.backend, listings: rec.listings.length, iface: rec.iface, gpu: hw.gpu };
}

/**
 * Why a step does not apply to the record ('' = it applies; an unknown id applies).
 *
 * @param {Step[]} steps
 * @param {string} id
 * @param {Rec} rec
 * @param {Hw} hw
 * @returns {string}
 */
export function skipOf(steps, id, rec, hw) {
  return steps.find((x) => x.id === id)?.skip?.(stepContext(rec, hw)) || '';
}

/**
 * What the rail and the overview read for each part of a station.
 *
 * @param {string} name
 * @param {Rec} rec
 * @param {{ cuda: string, ecores: string }} settings  the hardware settings Save writes
 * @returns {Summary}
 */
export function summaryOf(name, rec, settings) {
  return {
    name,
    backend: rec.backend,
    device: rec.resolved ?? (rec.listings.length === 1 ? rec.listings[0] : null),
    listings: rec.listings.length,
    discovery: rec.ipv6 ? rec.v6 : null,
    resolved: !!rec.resolved,
    iface: rec.iface,
    limits: rec.iface ? rec.limits : null,
    bits: Number(rec.bits) || 0,
    gain: Number(rec.gaincomp),
    volume: rec.volume,
    headroom: rec.iso === '2' ? -6 : -3,
    cuda: settings.cuda,
    ecores: settings.ecores === 'pool',
  };
}

/**
 * A listing's state in the record: picked, left dead by a resolved pair, or the one locked in.
 *
 * @param {Rec} rec
 * @param {string} str
 * @returns {ListingState}
 */
export function listingState(rec, str) {
  const on = rec.listings.includes(str);
  return { on, dead: !!rec.resolved && on && rec.resolved !== str, locked: rec.resolved === str };
}

/**
 * The listings a resolved pair left dead, across the records given, in record order.
 *
 * @param {Rec[]} recs
 * @returns {string[]}
 */
export function deadListings(recs) {
  return recs.flatMap((r) => (r.resolved ? r.listings.filter((l) => l !== r.resolved) : []));
}

/**
 * The Device step: the backend's list less the dead listings the record has not picked, grouped, or the NAA bring-up
 * (asked for, or a network list with nothing on it; no NAA shows until devices are refreshed when `naaSeen` is false).
 *
 * @param {{ kind: string, all: string[], rec: Rec, hidden: Set<string>, naaSeen: boolean, bringUp: boolean }} o
 * @returns {DeviceView}
 */
export function deviceView({ kind, all, rec, hidden, naaSeen, bringUp }) {
  const net = kind === 'network';
  const offered = all.filter((l) => !hidden.has(l) || rec.listings.includes(l));
  const list = net && !naaSeen ? [] : offered;
  const groups = groupDevices(kind, list).map(({ group, rows }) => ({ group, rows: rows.map((p) => ({ ...p, ...listingState(rec, p.str) })) }));
  return { bringUp: net && (bringUp || !list.length), found: list.length, groups };
}

/**
 * The record with a Connection answer: a connection that fixes the limits writes them; any answer asks the 48k-family
 * check again.
 *
 * @param {Rec} rec
 * @param {Iface[]} ifaces
 * @param {string} v
 * @returns {Rec}
 */
export function withConnection(rec, ifaces, v) {
  const f = ifaces.find((q) => q.v === v)?.fixed;
  if (!f) return { ...rec, iface: v, detected: false };
  return { ...rec, iface: v, limits: { pcm: f.pcm, sdm: f.sdm }, dsd: f.dsd, dsd48: f.dsd48, detected: false };
}

/**
 * Where the Rates step stands: Connection unanswered, the 48k-family check owed, running, or the limits ready.
 *
 * @param {Rec} rec
 * @param {{ done: boolean } | undefined} run  the check this edit started, if any
 * @returns {RatesPhase}
 */
export function ratesPhase(rec, run) {
  if (!rec.iface) return 'unanswered';
  const usb = rec.iface === 'usb';
  if (usb && !rec.detected && !run) return 'detect';
  if (usb && run && !run.done) return 'checking';
  return 'ready';
}

/**
 * The Rates step's dial and readouts: a connection that fixes the limits caps the dial there (and takes the whole SDM
 * band when it carries no DSD); without DSD the SDM hand rests on the band's lowest tier.
 *
 * @template {Tier} T
 * @param {Rec} rec
 * @param {Iface[]} ifaces
 * @param {T[]} tiers
 * @returns {RateView<T>}
 */
export function rateView(rec, ifaces, tiers) {
  const noDsd = rec.limits.sdm == null;
  const cap = ifaces.find((q) => q.v === rec.iface)?.fixed;
  const over = (/** @type {Fixed} */ c, /** @type {T} */ t, /** @type {number} */ i) => (t.family === 'pcm' ? i > c.pcm : noDsd || i > Number(c.sdm));
  const marked = tiers.map((t, i) => ({ ...t, unavailable: !!(t.unavailable || (cap && over(cap, t, i))) }));
  const sdmLo = tiers.findIndex((t) => t.family === 'sdm');
  return {
    noDsd,
    tiers: marked,
    dial: { pcm: rec.limits.pcm, sdm: rec.limits.sdm ?? sdmLo },
    dsd48: !noDsd && rec.dsd48 === '48k',
  };
}

/**
 * The limits the dial's value (`pcm|sdm` tier indices) sets; a record without DSD keeps none.
 *
 * @param {string} value
 * @param {boolean} noDsd
 * @returns {Limits}
 */
export function dialLimits(value, noDsd) {
  const [p, q] = value.split('|').map(Number);
  return { pcm: p, sdm: noDsd ? null : q };
}

/**
 * Which of the Hardware step's questions and readouts show.
 *
 * @param {Hw} hw
 * @returns {HardwareView}
 */
export function hardwareView(hw) {
  const gpu = !!hw.gpu;
  return { gpu, twoCards: gpu && hw.gpus === '2', power: gpu && hw.gpus !== '2', ecoresManual: !!hw.ecores };
}

/**
 * An option's label, else the value itself.
 *
 * @param {{ v: string, label: string }[]} options
 * @param {string} v
 * @returns {string}
 */
export function optionLabel(options, v) {
  return options.find((x) => x.v === v)?.label ?? v;
}

/**
 * The IPv6 check's verdict: discovery stays on IPv4 when the device does not stay visible.
 *
 * @param {boolean} fail  the device dropped out with IPv6 on
 * @returns {Ipv6Verdict}
 */
export function ipv6Verdict(fail) {
  return { ok: !fail, v6: fail ? 'v4' : 'v6' };
}

/**
 * The USB listings check's verdict: on success the listing latest in the backend's list answers; on failure none is
 * locked in.
 *
 * @param {string | null | undefined} why  the failure the check met, if any
 * @param {string[]} listings
 * @param {string[]} all  the backend's device list, in order
 * @returns {UsbVerdict}
 */
export function usbVerdict(why, listings, all) {
  if (why) return { ok: false, resolved: null };
  return { ok: true, resolved: [...listings].sort((a, b) => all.indexOf(a) - all.indexOf(b)).at(-1) };
}

/**
 * The record after the 48k-family check: detected, native DSD, the device's announced limits, and 48k-family DSD as
 * found.
 *
 * @param {Rec} rec
 * @param {boolean} found48  the device carries 48k-family DSD
 * @param {Limits} limits    the limits the device announces
 * @returns {Rec}
 */
export function dsd48Verdict(rec, found48, limits) {
  return { ...rec, detected: true, dsd48: found48 ? '48k' : '44k', dsd: 'native', limits: { ...limits } };
}
