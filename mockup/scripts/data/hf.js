// HF filter stage drawer: schema + mock values.
// Strings: data/settings.json (manual §2.8 "Playback filter" tooltip + per-option copy; manual §4.7 pre_before_meter),
// store/schema/output.js (label "High-frequency filter", sublabel "Playback filter"),
// widgets/AutopilotToggle.js (label + note, owner copy), engine-enums.json junk_filters (option names).
//
// Lanes differ per row; the head's `↻ restart` shows because one row restarts:
//   High-frequency filter  live   SetJunkFilter, switchable during playback. Applies at once, never stages.
//   HF filter auto-pilot   —      HQPTuner backend switch (POST /api/autopilot), no daemon setting. Applies at once.
//                                 Setting the filter by hand switches it off.
//   Pre-process before metering  http  restore lane, ~5.6 s daemon restart. Stages.
// Mock state: filter none (stage off), auto-pilot off, pre-process before metering off.

const MAN = {
  hf: 'Various playback filters are provided to deal with noise, errors, and distortion, for example in bad quality or fake hi-res sources. These filters can be switched at any time during playback. To see their effect on the source, pre-process before metering can be enabled.',
  autopilot: 'Automatically engages and disengages the high-frequency filter 20k to 50k settings as needed for hi-res content. Setting the filter manually disables this setting.',
  preMeter: 'When enabled, pre-processing, such as the 20 kHz filter, is run before metering. This allows one to see the effect of the pre-process, but it may make it harder to detect when to disable the 20 kHz filter again.',
};

// Engine enumeration (GetJunkFilters), in index order, with the manual's copy for each option.
const SLOW = 'Slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hi-res recordings that are, for example, transfers from analog tape.';
export const HF_OPTIONS = [
  { v: 'none', man: 'No filtering.' },
  { v: '20k', man: 'Useful for cleaning up fake hi-res content when such is observed through metering. It will place a sharp roll-off filter at 20 kHz.' },
  { v: '30k', man: SLOW },
  { v: '40k', man: SLOW },
  { v: '50k', man: 'Very slow roll-off filter for cleaning out, for example, excessive noise shaping from certain ADCs and DSD to PCM conversions.' },
  { v: '2x', man: 'Places steep cut-off at 2x of the base rate.' },
  { v: '4x', man: 'Places steep cut-off at 4x of the base rate.' },
  { v: '8x', man: 'Places steep cut-off at 8x of the base rate.' },
];

const OFF_ON = [{ v: '0', label: 'Off' }, { v: '1', label: 'On' }];

export const HF_DRAWER = {
  id: 'hf',
  title: 'HF filter',
  aria: 'HF filter settings',
  restart: false,
  tabs: [{
    id: 'hf', label: 'HF filter',
    body: [
      { row: {
        label: 'High-frequency filter', sub: 'Playback filter', live: true, man: MAN.hf,
        optMan: HF_OPTIONS,
        control: { type: 'seg', id: 'hfsel', cls: 'enum', aria: 'High-frequency filter', value: 'none',
          options: HF_OPTIONS.map((o) => ({ v: o.v, label: o.v })) },
      } },
      { row: {
        label: 'HF filter auto-pilot', live: true, man: MAN.autopilot,
        control: { type: 'seg', id: 'hfauto', aria: 'HF filter auto-pilot', value: '0', options: OFF_ON },
      } },
      { row: {
        label: 'Pre-process before metering', restart: true, man: MAN.preMeter,
        control: { type: 'seg', id: 'premeter', aria: 'Pre-process before metering', value: '0', options: OFF_ON },
      } },
    ],
  }],
};
