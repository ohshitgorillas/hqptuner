// Option lists and rate tables for the control catalog parts (store/schema.js).

// Fixed friendly rate menus. Values are the 48k-base member of each tier, and
// they mean a TIER rather than a frequency — see the rate-slot note on pcm_rate.
// Frequency-carrying labels ("1x (44.1 / 48 kHz)") were tried and dropped —
// they clip in the third-width Rate box (user decision).
//
// No "Auto" entry, deliberately. The slot these write (defaults_*) has none on
// the daemon's own form, and the slot LIVE writes reaches the same outcome by
// picking the tier: verified live on 6.0.4, an unset rate under a DSD512 limit and
// a pinned DSD512 both play a 44.1k source at 22579200. A menu entry whose only
// effect is to stop naming the tier is what made the two views disagree.
export const PCM_RATES = [
  { value: "48000", label: "1x" },
  { value: "96000", label: "2x" },
  { value: "192000", label: "4x" },
  { value: "384000", label: "8x" },
  { value: "768000", label: "16x" },
  { value: "1536000", label: "32x" },
];
export const DSD_RATES = [
  { value: "3072000", label: "DSD64" },
  { value: "6144000", label: "DSD128" },
  { value: "12288000", label: "DSD256" },
  { value: "24576000", label: "DSD512" },
  { value: "49152000", label: "DSD1024" },
  { value: "98304000", label: "DSD2048" },
];
// Every tier above has a 44.1k member as well as the 48k one the menus carry
// (DSD512 is 22579200 or 24576000), and a menu entry means the TIER rather than
// the frequency beside it. Anything asking "is this tier reachable" — the LIVE
// rate columns, the device-capability narrowing — has to ask about both members,
// so the pairing lives here with the tables it pairs.
/** @type {Record<string, string>} */
export const TWIN_44K = {
  48000: "44100",
  96000: "88200",
  192000: "176400",
  384000: "352800",
  768000: "705600",
  1536000: "1411200",
  3072000: "2822400",
  6144000: "5644800",
  12288000: "11289600",
  24576000: "22579200",
  49152000: "45158400",
  98304000: "90316800",
};
// Either member of a tier back to the menu value that names it.
export const TIER = Object.entries(TWIN_44K).reduce(
  (all, [base, twin]) => ({ ...all, [base]: base, [twin]: base }),
  /** @type {Record<string, string>} */ ({}),
);

// Optimal ISO fuses an enable and a headroom level into one attribute, so it is
// one three-way control rather than a checkbox plus a level (HQPlayer Desktop
// renders the same thing as a tri-state checkbox, which reads as ambiguous).
export const ISO_LEVELS = [
  { value: "0", label: "Off" },
  { value: "1", label: "−3 dB" },
  { value: "2", label: "−6 dB" },
];
// The card gate switches. A card's master switch is a state the card is IN, not
// an item on a checklist, so the six of them render as a two-button segment
// instead of a checkbox. Signal-path processing says ENGAGE / BYPASS — a
// bypassed plugin passes the signal through untouched, which is what the daemon
// actually does with it. Fixed volume and logging gate nothing in the signal
// path (there is nothing to bypass), so they say ON / OFF.
export const ENGAGE_BYPASS = [
  { value: "1", label: "ENGAGE" },
  { value: "0", label: "BYPASS" },
];
export const ON_OFF = [
  { value: "1", label: "ON" },
  { value: "0", label: "OFF" },
];
export const DSD_TRANSPORT = [
  { value: "0", label: "Native DSD" },
  { value: "1", label: "DSD over PCM (DoP)" },
];
export const DSD_RATE_FAMILIES = [
  { value: "0", label: "44.1kHz only" },
  { value: "1", label: "+48kHz family" },
];
export const DISCOVERY = [
  { value: "0", label: "IPv4" },
  { value: "1", label: "+IPv6" },
];
export const SOURCE_GAIN = [
  { value: "0", label: "0 dB" },
  { value: "1", label: "+6 dB" },
];
// direct_sdm as a path choice: "Direct" is DirectSDM on (all processing
// bypassed on the DSD→SDM path), "Processed" is the normal chain.
export const DSD_PLAYBACK = [
  { value: "0", label: "Processed" },
  { value: "1", label: "Direct" },
];
// Fixed mode segment — order PCM / SDM (DSD) / Auto, stable http `mode` values.
export const MODES = [
  { value: "pcm", label: "PCM" },
  { value: "sdm", label: "SDM (DSD)" },
  { value: "auto", label: "Auto" },
];
