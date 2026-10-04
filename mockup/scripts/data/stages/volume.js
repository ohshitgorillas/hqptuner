// Playback volume (live lane). Mock state: volume active at −12.5 dB.
// Range and step are mock values; the real ones come from the Volume drawer (Range) and the engine.

export const VOLUME = {
  value: -12.5,
  min: -60,
  max: 0,
  step: 0.5,
  scale: [-60, -40, -20, -10, 0], // slider scale marks, dB
};

// ── Volume stage drawer: schema + mock values ───────────────────────────────
// Strings: store/schema/volume.js (labels, sublabel, option sets, units), data/settings.json tooltips (manual copy,
// verbatim), store/schema/gray.js gray reasons (owner copy, verbatim).
// Fixed volume = one choice: Off | Manual | Auto. Manual enables the dBFS level
// (fixed_volume_enabled + fixed_volume); Auto enables −3 dB | −6 dB (volume_fixed 1/2). The manual frames Auto
// headroom as "a special fixed volume", so both live under Fixed volume. Each line carries its manual paragraph.
// The playback level itself lives in the engine-row control, never here (one home per setting).
// Lanes: Adaptive volume is live (SetAdaptiveVolume); every other row is http (restore, ~5.6 s restart); the head's
// `↻ restart` shows on every tab, since each holds a restart row. Gray reasons read staged values, so they follow the controls at once.
// Mock state: fixed volume Off (manual level −3 dBFS parked, Auto at −3 dB), range −60…0 dB, startup −20, gain comp 0 dB,
// adaptive volume off, playlist album gain off.

const VMAN = {
  off: "Volume is adjustable live.", // owner copy
  fixed: "Fixed value setting that the user cannot change on the fly.",
  fixedLevel:
    "Fixed volume in dBFS. When using any resampling, the maximum recommended volume level is -3 dBFS, to avoid inter-sample overloads and in case the material contains digital clipping/limiting. Note! High oversampling ratios can generate high inter-sample overs. Overloading the delta-sigma modulator in SDM mode will also cause audible noises. It is therefore recommended to keep the software volume at -3 dB or lower when using PCM to SDM conversion to avoid overloads, especially if the source material contains digital clipping.",
  iso: "Enables a special fixed volume with an optimized level setting that has enough headroom for most typical inter-sample overs. This is a recommended setting when HQPlayer's digital volume control is not needed due to the use of some external volume control method. The -3 dB setting puts the volume at roughly -3 dB; the -6 dB setting at roughly -6 dB. The -6 dB setting is good for music content where the normal -3 dB setting doesn't provide enough headroom, such as heavily clipped content.",
  max: "Maximum output volume setting in dB. Also allows positive values (gain). Together with the minimum, this configures the adjustment range of the volume control. Setting both to the same value gives a fixed volume at that level. Note! When both values are set to zero (0), volume control is bypassed completely. However, this is not suitable for normal cases since it will cause inter-sample overs and thus limiting, either on the HQPlayer side or on the DAC side.",
  min: "Minimum output volume setting in dB — the bottom of the volume control's adjustment range.",
  startup: "Startup volume setting if defined.",
  gainComp:
    "Many DACs have different output levels for 0 dBFS PCM vs 0 dB DSD. PCM gain compensation can be used to compensate for this level difference.",
  adaptive:
    "Applies adaptive gain during playback based on metadata or library analysis data; ReplayGain 2.0 metadata is used to offset the volume. Note! If the metadata includes positive gain values, extra headroom may be needed using the volume control.",
  albumGain:
    "When enabled, album gain is used for playlist items instead of track gain. This can be desirable on playlists with multiple complete albums.",
};

// Gray reasons (gray.js, verbatim). v = current (staged) values by control id. Exported: data/xrefs.js links each to the
// tab that fixes it (Level, Range).
export const VOLUME_REASON = {
  fixed: "Fixed volume bypasses the volume control.",
  zero: "Volume min and max are both 0 — volume control is bypassed. Not suitable for normal cases, since it will cause inter-sample overs and thus limiting either at HQPlayer side or at the DAC side.",
};
/** @type {Record<'range' | 'bypassed', (v: Record<string, unknown>) => string>} */
const GRAY = {
  range: (v) => (v.vfixmode !== "off" ? VOLUME_REASON.fixed : ""),
  bypassed: (v) => GRAY.range(v) || (Number(v.vmin) === 0 && Number(v.vmax) === 0 ? VOLUME_REASON.zero : ""),
};

const ON_OFF = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];
/**
 * A dBFS number control.
 *
 * @param {string} id
 * @param {string | null} label
 * @param {number} value
 * @param {(v: Record<string, unknown>) => string} [gray]
 * @returns {import('./output.js').Control}
 */
const dbNum = (id, label, value, gray) => ({
  type: "number",
  id,
  label,
  value,
  min: -120,
  max: 20,
  step: 0.5,
  unit: "dBFS",
  aria: label,
  gray,
});

/** @type {import('./output.js').DrawerSchema} */
export const VOLUME_DRAWER = {
  id: "volume",
  title: "Volume",
  aria: "Volume settings",
  restart: false,
  tabs: [
    {
      id: "level",
      label: "Level",
      body: [
        {
          row: {
            label: "Fixed volume",
            restart: true,
            man: VMAN.fixed,
            control: {
              type: "choice",
              id: "vfixmode",
              aria: "Fixed volume",
              value: "off",
              options: [
                { v: "off", label: "Off", man: VMAN.off },
                { v: "manual", label: "Manual", man: VMAN.fixedLevel, control: dbNum("vlevel", null, -3) },
                {
                  v: "auto",
                  label: "Auto",
                  sub: "Optimal ISO",
                  man: VMAN.iso,
                  control: {
                    type: "seg",
                    id: "viso",
                    aria: "Auto headroom level",
                    value: "1",
                    options: [
                      { v: "1", label: "−3", unit: "dB" },
                      { v: "2", label: "−6", unit: "dB" },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
    },
    {
      id: "gain",
      label: "Gain",
      body: [
        {
          row: {
            label: "Adaptive volume",
            live: true,
            man: VMAN.adaptive,
            control: {
              type: "seg",
              id: "vadapt",
              aria: "Adaptive volume",
              value: "0",
              options: ON_OFF,
              gray: GRAY.bypassed,
            },
          },
        },
        {
          row: {
            label: "Playlist album gain",
            restart: true,
            man: VMAN.albumGain,
            control: { type: "seg", id: "valbum", aria: "Playlist album gain", value: "0", options: ON_OFF },
          },
        },
        {
          row: {
            label: "PCM gain compensation",
            restart: true,
            man: VMAN.gainComp,
            control: {
              type: "number",
              id: "vgaincomp",
              value: 0,
              min: -6,
              max: 0,
              step: 0.5,
              unit: "dB",
              aria: "PCM gain compensation",
            },
          },
        },
      ],
    },
    // Range: HQPTuner v1's range bar (components/volume-range.js), a drawer block that stages through the block context.
    { id: "range", label: "Range", restart: true, body: [{ block: "range" }] },
  ],
};

// Range tab. Axis + clamp from v1 lib/volume.js; loudness bounds default −60 / −20 (v1 RangeBar defaults).
// Loudness bounds are Loudness settings (post_loudness_range low/high): shown on the bar for reference, set in the
// Loudness drawer (its `Loudness ›` link opens that drawer; main.js wires openLoudness). Mock: loudness engaged (rail), bounds at the defaults.
export const VOLUME_RANGE = {
  label: "Range",
  axis: { min: -120, max: 12 },
  ids: { min: "vmin", startup: "vstart", max: "vmax" },
  min: -60,
  startup: -20,
  max: 0,
  level: VOLUME.value,
  gray: GRAY.range,
  man: [
    { k: "Min volume", text: VMAN.min },
    { k: "Max volume", text: VMAN.max },
    { k: "Startup volume", text: VMAN.startup },
  ],
  loudness: {
    on: true,
    low: -60,
    high: -20,
    man: [
      { k: "Range lower bound", text: "The volume setting where, at or below, the maximum loudness value is reached." },
      { k: "Range upper bound", text: "The volume setting where, at or above, the loudness value reaches 0 dB." },
    ],
  },
};
