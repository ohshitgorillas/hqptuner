// Station builder (header button): the setup wizard's station walk (repo docs/wizard/wizard.md §1, §1.1–§1.6, §4), one
// station at a time. Copy marked `wizard` is the owner's wizard copy, verbatim, with the wizard's `preset` renamed
// `station` (v2 naming: a Station is the whole hqplayerd config; the Settings hardware drawer made the same rename).
// Copy marked DRAFT is agent copy awaiting the owner. Manual copy comes from data/output.js, data/volume.js and
// data/settings.js (shared, not repeated).
//
// Mock records: what each mock station holds (data/stations.js names). Devices are engine strings (data/output.js
// DEVICES); `listings` holds every listing picked for the one device (two = a DDC's pair, resolved or not).

import { DEVICES, RATE_TIERS } from './output.js';

// ── Copy ────────────────────────────────────────────────────────────────────
export const STB_COPY = {
  // Overview intro: wizard §1 intro (first paragraph) + wizard welcome (its last sentence).
  intro: [
    'Stations are collections of settings applied all at once, useful for switching between different device endpoints/setups, e.g., a headphone rig in a home office versus a speaker rig in the living room, or going from living room to den setups. The "backend" setting determines how the 1s and 0s arrive at that station\'s endpoint, i.e., via direct connection (ALSA) or over your home network (NAA).',   // wizard §1
    'None of these choices or selections are binding: everything can be re-configured later.',   // wizard welcome
  ],
  holds: 'What this station holds',            // DRAFT (Profile builder's `What this profile holds`)
  overview: 'Overview',
  change: 'Change something',
  scratch: 'Start from scratch',
  back: 'Back', next: 'Next', review: 'Review',
  skipped: 'Skipped',
  stepOf: (n, t) => `Step ${n} of ${t}`,
  newStation: 'New station',                    // DRAFT (Profile builder's `New profile`)
  name: 'station name',                         // DRAFT (v1 ProfileCard placeholder grammar)
  profiles: 'Matrix profiles',                  // DRAFT: the hold row that opens the Profile builder
  state: {                                      // DRAFT (Profile builder's state lines)
    dirtyLoaded: 'Unsaved changes. Saving restarts the engine with this station.',
    dirty: 'Unsaved changes.',
    loaded: 'Saved · loaded now.',
    saved: 'Saved.',
  },
  noName: 'Enter a name first',                                            // v1 Ask.js
  overwrite: (n) => `Station "${n}" already exists. Overwrite it?`,        // v1 Ask grammar (Snapshot builder's)
  remove: (n) => `Delete station "${n}"? This cannot be undone.`,          // v1 Ask grammar
  combo: 'While you can set up any number of endpoints/stations in this wizard, it only supports configurations that stream to one device at a time. If your target is multiple endpoints *at once* (HQPlayer\'s "Combo" backend), you\'ll need to configure that yourself.',   // wizard §1
};

// ── The walk ────────────────────────────────────────────────────────────────
// guide(x) = the step's question or lead (wizard copy where the wizard has one); skip(x) = why it doesn't apply ('' = it
// does). x = {backend, listings, iface, gpu}.
export const STB_STEPS = [
  { id: 'name', title: 'Name',
    guide: () => 'Give this station a name, e.g., "living room speakers".' },                                    // wizard §1
  { id: 'backend', title: 'Backend',
    guide: () => 'How is the music getting from HQPlayer to your DAC? This determines the backend type for this station: ALSA (advanced Linux sound architecture) or NAA (network audio adapter).' },   // wizard §1.1
  { id: 'device', title: 'Device',
    guide: () => 'Select the device for this station from the list.' },                                        // wizard §1.3
  { id: 'ipv6', title: 'IPv6',
    guide: () => 'Does your home LAN use IPv6 addressing? This determines whether HQPlayer uses IPv6 to discover and stream to NAAs.',   // wizard §1.4
    skip: (x) => (x.backend === 'network' ? '' : 'Skipped: IPv6 discovery is for network endpoints (NAA).') },   // DRAFT
  { id: 'usb', title: 'USB listings',                                                                           // DRAFT title (wizard: USB Disambiguation)
    guide: () => 'Using a DDC or transport before your DAC and connecting it to the DAC over USB generates two device listings for the same hardware, but only one of them actually works (produces sound). To ensure you actually hear music once you press Play, we need to figure out which of those listings is correct.',   // wizard §1.5
    skip: (x) => (x.listings > 1 ? '' : 'Skipped: one listing was picked for this device.') },                   // DRAFT
  { id: 'iface', title: 'Connection',                                                                           // DRAFT title
    guide: () => 'How does your DAC receive its input signal from HQPlayer? If you use a separate streamer, DDC, or transport, how does *that* send the signal to your DAC?' },   // wizard §1.5 Rate detection
  { id: 'rates', title: 'Rates',
    guide: (x) => (x.iface === 'usb' ? null : 'Your connection sets these limits.') },   // USB: the 48k check prints here; DRAFT otherwise
  { id: 'dac', title: 'DAC bits · Gain',                                                                        // DRAFT title
    guide: () => 'If you\'re planning on outputting PCM, especially on a DAC with R-2R ladder topology, you\'ll want to find the "DAC bits" setting. This tells HQPlayer where the noise floor of your DAC is so that it can apply dithering correctly.' },   // wizard §1.5
  { id: 'volume', title: 'Volume',
    guide: () => 'Do you plan on using HQPlayer/HQPTuner for volume control for this station, or using a different means of volume control?' },   // wizard §1.6
  { id: 'hardware', title: 'Hardware',
    guide: () => 'In this section, we\'re going to generate some first-pass hardware acceleration settings.' },   // wizard §4
];

// ── Step copy (wizard, verbatim) ────────────────────────────────────────────
export const STB_TIPS = {
  // Name step (wizard §1).
  name: 'if you are adding a headphone setup with multiple headphones, each with a distinct EQ profile, you can add those later as separate "matrix profiles" under the same station. There\'s no need to create a different station per headphone/EQ profile.',
  power: ['If the device isn\'t plugged in and/or powered on yet, do that now, give it a minute to boot up, and click Next. Or, see the instructions for setting up a network endpoint ', 'here', '.'],   // `here` links to NAA bring-up
};

/** Backend choice lines: the wizard's answers (labels) with the manual's sentence for each backend (data/output.js MAN.backend, split). */
export const STB_BACKENDS = [
  { v: 'network', label: 'HQPlayer streams to this endpoint over my home network (NAA)',
    man: 'Network uses a Signalyst Network Audio Adapter — for the Network Audio driver type, a list of remote audio devices is shown.' },
  { v: 'alsa', label: 'My HQPlayer device outputs directly to my DAC or DDC (ALSA)',
    man: 'ALSA uses an ALSA hardware device.' },
];

/** Device step (wizard §1.3), the bring-up (§1.2, shown on demand and whenever an NAA backend lists nothing). */
export const STB_DEVICE = {
  same: 'If there are multiple endpoints of the same device/style and you can\'t tell which is which (e.g., two Holo Reds on the same network), power the other(s) down and click Refresh devices so that only the correct device is left.',
  both: 'If there is only one physical device but multiple listings, select both and we\'ll disambiguate them in a minute.',
  refresh: 'Refresh devices',                                                    // wizard's name for the action
  refreshCost: 'Stops the engine. All live settings except matrix profiles survive.',   // owner copy (Output drawer rescan caption)
  bringUpLink: 'Network Audio Adapters',                                         // DRAFT: the link to the bring-up
  none: 'No network audio adapters found.',                                      // DRAFT
  bringUp: {
    intro: 'Network Audio Adapters (NAAs) come in three flavors:',
    flavors: [
      { k: 'NAA OS', text: ['Download the latest NAA OS image from ', { a: 'Signalyst\'s website', href: 'https://signalyst.com/bins/naa/' }, ', flash it onto an SD card (or whatever the device uses for a boot drive/OS storage), and let the endpoint device boot that directly.'] },
      { k: 'Built-in', text: ['the device features an HQPlayer NAA plugin or mode which is enabled through its native settings. Consult your device\'s manual.'] },
      { k: 'DIY', text: ['the ', { code: 'networkaudiod' }, ' package, also available directly from ', { a: 'Signalyst', href: 'https://signalyst.com/bins/naa/' }, '.'] },
    ],
    tip: 'The NAA OS is highly optimized; use it whenever possible unless you also want to use non-HQPlayer sources.',
    ready: 'Once the NAA is connected to the network, booted up, and ready, click Refresh devices and make sure it\'s there. If you see multiple ambiguous listings, don\'t worry, we\'ll sort that out later. If you don\'t see the device at all, you\'ll need to figure out why it\'s not appearing before proceeding.',
    critical: 'CRITICAL: READ THIS',
    firewall: 'HQPlayer *will* fail to find NAAs in the presence of a firewall. The HQPlayer host system\'s firewall must be disabled or removed entirely.',
    cmds: [
      { k: 'On Debian or Ubuntu Server:', cmd: 'sudo systemctl stop ufw && sudo systemctl disable ufw' },
      { k: 'On Fedora:', cmd: 'sudo systemctl stop firewalld && sudo systemctl disable firewalld' },
    ],
    fallback: ['If that doesn\'t work, try ', { code: 'sudo apt remove ufw' }, ' or ', { code: 'sudo dnf remove firewalld' }, ' respectively.'],
    back: 'Back to the list',                                                    // DRAFT
  },
};

/** IPv6 (wizard §1.4): the three answers, the checks' lines, Start / Skip. */
export const STB_IPV6 = {
  answers: [
    { v: 'yes', label: 'Yes' },
    { v: 'no', label: 'No' },
    { v: 'unknown', label: 'I don\'t know' },
  ],
  yes: { run: 'Enabling IPv6 and confirming the NAA remains visible...', ok: 'Got it.',
    fail: 'That didn\'t work. Let\'s leave IPv6 off for now. Don\'t worry: this won\'t affect performance at all, only how HQPlayer discovers and talks to the NAA.' },
  unknown: {
    lead: 'HQPTuner will detect whether your LAN can use IPv6 for NAA discovery by checking whether the device remains visible with IPv6 support engaged. This will restart the daemon once or twice.',
    ask: 'If you\'d rather skip this, click Skip below to stick with IPv4. Otherwise, click Start.',
    steps: ['Restarting the daemon with IPv6 enabled...', 'Verifying NAA endpoint visibility...'],
    ok: 'Confirmed! IPv6 works.',
    fail: 'Either this device or your home LAN doesn\'t seem to support IPv6. Don\'t worry: this doesn\'t affect performance at all, only how HQPlayer discovers and talks to this NAA.',
    start: 'Start', skip: 'Skip',
  },
};

/** USB listings (wizard §1.5 USB Disambiguation). */
export const STB_USB = {
  how: 'First, unplug the USB cable feeding the DAC or turn the DAC off, then click Disambiguate.',
  go: 'Disambiguate',
  run: 'Please hang tight while HQPTuner finds the remaining device listing...',
  ok: 'Got it! Saved. Plug the DAC back in and click Next.',
  fail: (why) => `HQPTuner wasn't able to disambiguate which device is correct, since ${why}. You'll need to experiment later: load each device and try to play content back. The one that produces sound is (obviously) correct.`,
  why: { gone: 'both devices disappeared', none: 'neither device went down' },
  locked: 'locked in',                       // DRAFT tag on the surviving listing
};

/** Connection (wizard §1.5 Rate detection): the interface answers; the last two fix the limits themselves. */
export const STB_IFACES = [
  { v: 'usb', label: 'USB or I2S/IIS' },
  { v: 'coax', label: 'AES/EBU or S/PDIF coaxial (4x PCM, DSD64 via DoP)', fixed: { pcm: 2, sdm: 6, dsd: 'dop', dsd48: '44k' } },
  { v: 'toslink', label: 'S/PDIF Toslink (2x PCM, no DSD)', fixed: { pcm: 1, sdm: null, dsd: 'dop', dsd48: '44k' } },
];

/** Rates step (wizard §1.5): the 48k-family check, then what the hardware supports. */
export const STB_RATES = {
  check: 'Checking whether your hardware supports 48kHz-family DSD rates...', ok: 'Got it.',
  here: 'Here\'s what your hardware supports:',
  confirm: 'If you\'re using a separate transport or DDC, confirm these limits with your DAC\'s manual to avoid your transport sending a rate that your DAC can\'t parse. If the real limits are lower than those above, change them now.',
  sdmNone: 'None',                                    // wizard's readout word: no DSD over this connection
  sdmNoneWhy: 'This connection carries no DSD.',     // DRAFT: the SDM band's reason under Toslink
};

/** DAC bits · Gain step (wizard §1.5, its last two paragraphs). */
export const STB_DAC = {
  known: 'Known good DAC bits values (from the HQPlayer manual):',
  values: [
    { k: 'Holo Audio Cyan 2, Spring, Spring 2, Spring 3, May', v: 20 },
    { k: 'Denafrips', v: 19 },
    { k: 'LAiV Harmony DAC, Harmony μDAC', v: 18 },
    { k: 'Schiit Bifrost 2/64, Gungnir 2, Yggdrasil LIM (DAC8812)', v: 16 },
  ],
  gain: 'Finally, if you plan on switching between PCM and DSD, you\'ll want to set PCM Gain Compensation so that the levels are even. A table in the HQPlayer manual (p. 16) shows levels for common DACs. If you can\'t find yours, leave it at 0dB for now.',
  gainSkip: 'PCM gain compensation evens the levels between PCM and native DSD; this connection carries no native DSD.',   // DRAFT
};

/** Volume (wizard §1.6). */
export const STB_VOLUME = {
  warn: 'Fair warning: there will always be a delay between HQPlayer controls and playback, including volume changes. This delay can be mitigated with careful configuration, but if instant volume changes are critical for you, skip this.',
  use: [
    { v: 'hqp', label: 'Yes', sets: 'Fixed volume Off · range −60 to −3 dB · startup −40 dB' },   // DRAFT readout of what it sets
    { v: 'other', label: 'No' },
  ],
  clip: 'Do you frequently listen to heavily clipped material?',
  clips: [
    { v: '2', label: 'Yes (-6dB auto headroom/optimal ISO)' },
    { v: '1', label: 'No (-3dB auto headroom/optimal ISO)' },
  ],
  hint1: 'The output level\'s absolute ceiling should be -3dB to prevent clipping during resampling.',
  hint2: 'Think about giving HQPlayer\'s volume control an honest shot. It\'s not your typical digital volume knob.',
  pitch: [
    'Traditional audiophile wisdom says that digital volume controls are bad (they drop significant bits, and therefore quality, to achieve volume decreases) and that volume should be adjusted as far up the chain as possible. That is *not* the case with HQPlayer\'s internal volume control, which never sees a quality loss at any level. Furthermore, consider the following:',
    { k: 'Perfect channel matching', text: 'Traditional analog volume potentiometers have small mismatches across their range between the left and right channels, which, when audible, leads to blurred imaging (stepped knobs and R-2R ladder-based volume control which use matched resistors per step are exempt from this). Digital volume control, on the other hand, is always perfectly matched. Turn your analog volume knob up all the way (at which point it is very likely well matched) and use HQPlayer for volume control, and you might be surprised at how much better the soundstage is!' },
    { k: 'Volume adaptive loudness', text: 'This feature accounts for the fact that our hearing itself is non-linear: lower frequencies get quieter than the midrange as the volume goes down. Loudness therefore boosts bass (and optionally treble) to keep music *sounding* linear regardless of the listening level. It needs calibrated to your setup\'s gain and your own hearing, but once it\'s dialed in, you may be surprised by how much more satisfying low-volume listening can be, which is better for your hearing in the long run.' },
  ],
  more: '… see more', less: 'see less',           // spec's `… see more` grammar
  /** What each answer writes (wizard §1.6): Yes = adjustable; No = Fixed volume Auto at the picked headroom. */
  adjustable: { vfixmode: 'off', vmin: -60, vmax: -3, vstart: -40 },
};

/** Hardware (wizard §4): asked here per station, written to every station on Save. */
export const STB_HW = {
  tip: 'Depending on your goals and the available processing power, further optimization may be required. For power users without top-of-the-line hardware, it will take some tweaking beyond what the wizard can do to truly maximize performance. You\'ll find these settings under Settings › Hardware acceleration.',   // wizard §4, `the System tab` → v2 place (flagged to the owner)
  has: 'Does your hardware have either of the following?',
  hasOpts: [{ v: 'gpu', label: 'Nvidia GPU(s)' }, { v: 'ecores', label: 'A CPU with E-cores' }],
  two: 'Do you have two Nvidia GPUs? If yes, enter their indices below (run `nvidia-smi` on the host machine).',
  twoOpts: [{ v: '1', label: 'One' }, { v: '2', label: 'Two' }],   // DRAFT seg labels for the wizard's yes / no
  idx: { hi: 'More powerful card:', lo: 'Less powerful card:', same: 'Both cards are identical' },
  power: 'How would you rate your Nvidia GPU\'s power?',
  powers: [
    { v: 'none', label: 'don\'t bother (no CUDA offloading)' },
    { v: 'low', label: 'low (convolution only)' },
    { v: 'high', label: 'moderate to high (convolution + resampling)' },
  ],
  result: 'Writes, to every station',              // DRAFT: the result row's label
  all: 'Every station runs on this machine, so Save writes these to all of them.',   // DRAFT
};

/**
 * Wizard §4's table → the Settings hardware drawer's values (data/settings.js HARDWARE_DRAWER ids).
 * Mapping (flagged to the owner): `on` multicore = Enabled ('1'); E-core DSP on = DSP pool; two cards = Full offload,
 * resampling (DSP device) on the more powerful card, convolution on the less powerful one.
 */
export function hwSettings(hw) {
  const ecores = hw.ecores ? 'pool' : 'default';
  const out = { multicore: '1', ecores, cuda: '0', cudadev: -1, cudacdev: -1 };
  if (!hw.gpu) return out;
  if (hw.gpus === '2') return { ...out, cuda: '1', cudadev: hw.same ? 0 : hw.hi, cudacdev: hw.same ? 1 : hw.lo };
  return { ...out, cuda: { none: '0', low: 'convolution', high: '1' }[hw.power] };
}

// ── Mock records ────────────────────────────────────────────────────────────
const NET = DEVICES.network.list;
const lim = (pcm, sdm) => ({ pcm, sdm });
/** Station defaults (Start from scratch / New station): IPv4 to start (wizard: IPv6 off until tested), nothing picked. */
export const STB_SCRATCH = {
  backend: 'network', listings: [], resolved: null, ipv6: '', v6: 'v4', iface: '', detected: false,
  limits: lim(RATE_TIERS.limits.pcm, RATE_TIERS.limits.sdm), dsd: 'native', dsd48: '44k', bits: 0, gaincomp: 0,
  volume: '', iso: '1',
};
export const STB_HW0 = { gpu: false, ecores: false, gpus: '1', hi: 0, lo: 1, same: false, power: 'none' };

export const STB_RECORDS = {
  // The loaded station: a Holo Red DDC (its two listings, resolved) into a Spring 3 over USB, HQPlayer volume.
  Speakers: { ...STB_SCRATCH, listings: [NET[1], NET[2]], resolved: NET[2], ipv6: 'yes', v6: 'v6', iface: 'usb', detected: true,
    limits: lim(3, 9), dsd: 'native', dsd48: '48k', bits: 20, gaincomp: -3, volume: 'hqp' },
  Headphones: { ...STB_SCRATCH, listings: [NET[0]], ipv6: 'no', iface: 'usb', detected: true,
    limits: lim(3, 8), dsd: 'native', dsd48: '44k', bits: 0, gaincomp: 0, volume: 'hqp' },
  // An S/PDIF HAT: coax fixes the limits; the amp has its own volume knob.
  Office: { ...STB_SCRATCH, listings: [NET[3]], ipv6: 'unknown', iface: 'coax', detected: true,
    limits: lim(2, 6), dsd: 'dop', dsd48: '44k', bits: 24, gaincomp: 0, volume: 'other', iso: '1' },
};
export const STB_HW_REC = { ...STB_HW0, gpu: true, power: 'low', ecores: true };
