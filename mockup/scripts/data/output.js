// Output stage drawer: schema + mock values.
// Strings: store/schema/output.js labels + options, data/settings.json tooltips (manual copy, verbatim),
// owner copy (rescan cost, isSdm advisory), config form 6.0.4 hints + device lists.
// Tabs: Format (mode, rate, family facts), Device (backend, channels, device rows). Mock state: SDM mode, Network backend. Format: one dual-band rate dial (PCM 1x–32x | SDM 64x–2048x, a needle each);
// family-only rows carry a band tag. Nothing grays by mode: both families stay settable (set PCM
// rate and DAC bits before switching to PCM).
//
// Tab body items:
//   {row}                        one setting row: control column | manual copy
//   {group: backend, rows}       rows that apply to one backend; shown when that backend (or Combo) is active
// Row: label, sub?, full? (stack control over copy), control, action?, advisory?, man
// Controls:
//   seg     {type, id?, aria, options:[{v,label}], value, switchesBackend?}
//   number  {type, id, value, min, max, unit?, hint?, aria}
//   device  {type, id, kind: 'network'|'alsa', aria}  → device-picker.js, list from DEVICES[kind]
//   dial    {type, id, aria}                           → rate-dial.js, tiers from RATE_TIERS

const MAN = {
  // Manual §4.2 "Default output mode", in full (it names [source], which HQPTuner doesn't offer, and says why).
  mode: "Selects default output mode. When set to “PCM”, all content is played as PCM output. When “SDM (DSD)” is selected, all content is played as SDM output. When “[source]” is selected, PCM content is played as PCM and DSD content is played as SDM. However, using “[source]” usually leads to sub-optimal result with either format since only very few DACs have separate true PCM (R2R) and SDM conversion sections inside. In most cases only either one of the options is optimal for the DAC.",
  backend:
    'Specifies the type of output device. ALSA uses an ALSA hardware device. Network uses a Signalyst Network Audio Adapter — for the Network Audio driver type, a list of remote audio devices is shown. Combo holds a set of sub-elements of type "alsa" and/or type "network"; these form a combined output device with as many channels as the sum of the channels of the sub-elements, and channel mapping follows the order of the sub-devices.',
  netDevice:
    "A list of remote audio devices is shown. This is always a combination of the NAA device plus the hardware device ID.",
  alsaDevice: "Lists all the available ALSA hardware audio endpoints.",
  discovery: "Enable/disable IPv6 support. Enabled by default.",
  bufferTime:
    "Length of the hardware audio buffer (in milliseconds); 0 is the driver default. It is recommended to use the driver default, unless audio drop-outs are experienced. When the driver default is used, the audio driver defines the length of the buffer. Values between 10 and 100 ms are most recommended. −1 selects the minimum buffer: never use it for normal playback; it can be attempted only for realtime inputs using the input backend.",
  channelOffset:
    "Base channel offset to transform channel maps — the channel which is considered to be the first in channel mapping (0-based). Left at 0 for a normal stereo or multichannel device; raised only to place output on higher channels of a multi-channel interface (e.g. offset 2 sends stereo to channels 3–4).",
  outputRate: "PCM and SDM target rates. Real values can be equal or lower when auto rate-family is used.", // owner consolidation of the manual's PCM rate + SDM rate copy
  dsdSupport:
    'DSD content can be transferred to/from the audio device by packing it into a suitable PCM container; select "DSD over PCM (DoP)" to use the DoP v1.1 standard. PCM mode does not use this setting.',
  dsdRates:
    "Allow any DSD base rate instead of being constrained to the 44.1 kHz base rate (e.g. DSD128x48 = 6.144 MHz). Only meaningful for DACs that accept 48k-family DSD rates.",
  channels:
    'Number of output channels; choices range from "2" for stereo to 128 output channels, primarily for complex matrix processing cases.', // manual §4.2 (v1 settings.json)
  dacBits:
    "Number of significant bits the DAC has; this is the dithering level. 0 auto-detects. When the DAC is connected to a unidirectional interface like S/PDIF, AES/EBU or I2S, it is important to select the correct number of bits. In addition, when a DAC is connected to USB and has something other than 32-bit input resolution, it is recommended to set the actual value here. Also, when a suitable noise-shaper, such as LNS15, NS9 or NS5, is used in combination with high output rates, linearity errors inherent to all R2R DACs can be corrected. This will lower the distortion of especially low-level signals and reduce zero-crossing distortions.",
};

const RESCAN = {
  label: "⟳ Rescan devices",
  caption: "Stops the engine. All live settings except matrix profiles survive.",
};
const BUFFER_HINT = "−1 = minimum, 0 = default";

const bufferRow = (id, value) => ({
  label: "Buffer time",
  man: MAN.bufferTime,
  control: { type: "number", id, value, min: -1, max: 250, unit: "ms", hint: BUFFER_HINT, aria: "Buffer time" },
});
const dsdSupportRow = (value) => ({
  label: "DSD support",
  band: "sdm",
  man: MAN.dsdSupport,
  control: {
    type: "seg",
    aria: "DSD support",
    value,
    options: [
      { v: "native", label: "Native DSD" },
      { v: "dop", label: "DSD over PCM (DoP)" },
    ],
  },
});
const dsdRatesRow = (value) => ({
  label: "DSD rates",
  band: "sdm",
  man: MAN.dsdRates,
  control: {
    type: "seg",
    aria: "DSD rates",
    value,
    options: [
      { v: "44k", label: "44.1kHz only" },
      { v: "48k", label: "+48kHz family" },
    ],
  },
});
const dacBitsRow = (id, value) => ({
  label: "DAC bits",
  sub: "Noise-shaping target depth",
  band: "pcm",
  man: MAN.dacBits,
  control: { type: "number", id, value, min: 0, max: 32, hint: "0 = default", aria: "DAC bits" },
});

export const BACKEND_NAMES = { network: "Network Audio", alsa: "ALSA" };

export const OUTPUT_DRAWER = {
  id: "output",
  title: "Output",
  aria: "Output settings",
  restart: true,
  backend: "network",
  tabs: [
    // Format: the rate dial and what the signal is (DSD packing, DSD rates, DAC bits).
    {
      id: "format",
      label: "Format",
      body: [
        // Output mode: live (manual §8: the active mode "can be changed at any time"); its other home is the Setting
        // Switcher's Output mode target (two homes, one state: main.js). No [source] option.
        {
          row: {
            label: "Output mode",
            live: true,
            man: MAN.mode,
            control: {
              type: "seg",
              id: "omode",
              aria: "Output mode",
              value: "sdm",
              options: [
                { v: "pcm", label: "PCM" },
                { v: "sdm", label: "SDM (DSD)" },
              ],
            },
          },
        },
        {
          row: {
            label: "Rate",
            full: true,
            man: [{ k: "Output rate", text: MAN.outputRate }],
            control: { type: "dial", id: "dial", aria: "Output rate" },
          },
        },
        { group: "network", rows: [dsdSupportRow("native"), dsdRatesRow("48k"), dacBitsRow("netbits", 20)] },
        { group: "alsa", rows: [dsdSupportRow("native"), dsdRatesRow("44k"), dacBitsRow("alsabits", 24)] },
      ],
    },
    {
      id: "device",
      label: "Device",
      body: [
        {
          row: {
            label: "Backend",
            man: MAN.backend,
            control: {
              type: "seg",
              id: "backend",
              aria: "Backend",
              value: "network",
              switchesBackend: true,
              options: [
                { v: "alsa", label: "ALSA" },
                { v: "network", label: "Network" },
                { v: "combo", label: "Combo" },
              ],
            },
          },
        },
        // Channels: every backend, so outside the backend groups (moved here from Format: Format must fit without scrolling).
        // The common layouts as one tap (owner's labels; channel counts are the daemon's: 2, 6, 8); Manual opens the
        // number (6.0.4 form: 2–32). Restart (http).
        {
          row: {
            label: "Channels",
            man: MAN.channels,
            control: {
              type: "group",
              items: [
                {
                  type: "seg",
                  id: "chlayout",
                  aria: "Channel layout",
                  value: "2",
                  options: [
                    { v: "2", label: "Stereo" },
                    { v: "6", label: "5.1" },
                    { v: "8", label: "7.1" },
                    { v: "manual", label: "Manual" },
                  ],
                },
                {
                  type: "number",
                  id: "channels",
                  value: 2,
                  min: 2,
                  max: 32,
                  aria: "Channels",
                  gray: (v) => (v.chlayout === "manual" ? "" : " "),
                },
              ],
            },
          },
        },
        {
          group: "network",
          rows: [
            {
              label: "Output device",
              man: MAN.netDevice,
              action: RESCAN,
              control: { type: "device", id: "netdev", kind: "network", aria: "Network Audio output device" },
            },
            {
              label: "Discovery",
              man: MAN.discovery,
              control: {
                type: "seg",
                aria: "Discovery",
                value: "v6",
                options: [
                  { v: "v6", label: "+IPv6" },
                  { v: "v4", label: "IPv4" },
                ],
              },
            }, // default (IPv6 on) leftmost
            bufferRow("netperiod", 0),
          ],
        },
        {
          group: "alsa",
          rows: [
            {
              label: "Output device",
              man: MAN.alsaDevice,
              action: RESCAN,
              control: { type: "device", id: "alsadev", kind: "alsa", aria: "ALSA output device" },
            },
            {
              label: "Channel offset",
              man: MAN.channelOffset,
              control: { type: "number", id: "alsaoffset", value: 0, min: 0, max: 31, aria: "Channel offset" },
            },
            bufferRow("alsaperiod", 100),
          ],
        },
      ],
    },
  ],
};

// Engine device strings, split on ": " by device-picker.js. Network = host: card: interface; ALSA = card: interface.
export const DEVICES = {
  network: {
    selected: 2,
    list: [
      "S26: Gustard Digital Output: USB Audio",
      "naa-7bdbb6cb: Holo Audio UAC2.0 Gen2 - RED: USB Audio",
      "naa-7bdbb6cb: Holo Audio UAC2.0 Gen2.1 Standa: USB Audio",
      "naa-office: snd_rpi_hifiberry_digi: HiFiBerry Digi+ Pro HiFi wm8804-spdif-0",
    ],
  },
  alsa: {
    selected: 0,
    list: ["HDA NVidia: HDMI 0", "HDA NVidia: HDMI 1", "HDA NVidia: HDMI 2", "HDA NVidia: HDMI 3"],
  },
};

// Rate tiers, 1x … 2048x: octave steps on one axis, each with its 44.1k-family and 48k-family member.
// PCM tiers in kHz (v1 PCM_RATES 1x–32x), SDM in MHz (64x–2048x). Two limits, one per family (index into tiers).
// unavailable: device announced it cannot carry the tier (example: 2048x). playing: rate running now.
export const RATE_TIERS = {
  tiers: [
    { family: "pcm", name: "1x", f44: "44.1", f48: "48", unit: "kHz" },
    { family: "pcm", name: "2x", f44: "88.2", f48: "96", unit: "kHz" },
    { family: "pcm", name: "4x", f44: "176.4", f48: "192", unit: "kHz" },
    { family: "pcm", name: "8x", f44: "352.8", f48: "384", unit: "kHz" },
    { family: "pcm", name: "16x", f44: "705.6", f48: "768", unit: "kHz" },
    { family: "pcm", name: "32x", f44: "1411.2", f48: "1536", unit: "kHz" },
    { family: "sdm", name: "64x", f44: "2.82", f48: "3.07", unit: "MHz" },
    { family: "sdm", name: "128x", f44: "5.64", f48: "6.14", unit: "MHz" },
    { family: "sdm", name: "256x", f44: "11.29", f48: "12.29", unit: "MHz" },
    { family: "sdm", name: "512x", f44: "22.58", f48: "24.58", unit: "MHz" },
    { family: "sdm", name: "1024x", f44: "45.16", f48: "49.15", unit: "MHz" },
    { family: "sdm", name: "2048x", f44: "90.32", f48: "98.30", unit: "MHz", unavailable: true },
  ],
  limits: { pcm: 3, sdm: 9 },
  playing: 9,
};
