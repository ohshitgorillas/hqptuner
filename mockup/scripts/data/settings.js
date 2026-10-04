// Settings: the gear swaps the body (rail + page + drawers) for this. Header, engine row and Setting Switcher stay.
// Rail = the categories, in the signal chain's stage grammar (engraved name, readouts, left selection bar) but no wire and no
// lamps: settings aren't signal flow, and lamps mean "engaged" on the chain. Each entry opens its drawer (drawers open
// only from the rail); the page under them is About + About HQPTuner (read-only, so a page, not a drawer).
//
// Strings: v1 data/settings.json (manual §4 / §4.2 / §4.7, readme §1.2 / §1.15, verbatim), v1 store/schema labels,
// v1 SystemTab.js / SystemHardware.js / LogTail.js / gray.js (owner copy), 6.0.4 config-form options.
// Lanes (v1 docs/settings-classification.md):
//   Timing                 http (restore lane, ~5.6 s restart): idle_time (ms on the wire), quick_pause, short_buffer
//   Hardware acceleration  file restore (<engine> element, ~5.6 s restart): cuda, cuda_dev, cuda_cdev, multicore, ecores, nblocks
//   UPnP                   http (restore lane, restart): upnp_freewheel
//   Logging                http: log_enabled, log_file; live tail read-only (HQPTuner)
//   Behavior               HQPTuner prefs: apply at once, never stage (Allow pinned rates)
//   Visual settings        HQPTuner client prefs: apply at once, never stage
// Mock state: idle Default, quick pause off, short buffer Normal; CUDA disabled, multicore auto, e-cores default, nblocks 0;
// log on at /tmp/hqplayerd.log (6.0.4 form fixture); every visual pref at v1's default but the accent (v2 amber).

const MAN = {
  idle: 'Defines the amount of time the engine is left idling after playback of the current content has ended. This allows a faster playback restart within the idle period.',
  quickPause: 'Changes the pause operation to play a basic silence pattern. In some cases, this reduces the delay when pressing pause, but it can cause audible glitches, especially when the DAC is directly connected to a power amp without intermediate volume control.',
  shortBuffer: 'Length of the FIFO (first in, first out buffer) to adjust control responses. This reduces the amount of delay for volume control, for example, but also increases the likelihood of audio drop-outs.',
  cuda: 'Utilizes an NVIDIA GPU to partially offload processing from the CPU to the GPU. CUDA offload requires an NVIDIA GPU with a minimum Compute Capability level of 5.2, 2 GB of graphics RAM, and the latest official NVIDIA drivers. When CUDA offload is enabled, Multicore DSP should also be enabled, or left at the automatic setting, to achieve the best performance. With "convolution only", only convolution algorithms are offloaded to the GPU.',
  cudaDevs: 'Which GPU handles each offload class: one device for filters and general DSP, another for convolution and other large operations. Setting them to different GPUs splits the workload across two cards. −1 selects automatically.',
  multicore: 'Multicore DSP increases parallelization of various DSP operations. With "auto", automatic detection and configuration is active and can utilize any number of cores. For best performance, it is recommended to use the auto-detection. When disabled, processing is optimized for cases where the number of cores is equal to or less than the number of output channels, such as dual-core CPUs when output is stereo. When enabled, processing is optimized for modern multi-core CPUs with a much higher core count than the number of output channels. Since this parallelization increases processing overhead, it will increase total CPU time consumption. If there are performance problems with the "auto" setting, it is typically useful to try this option.',
  ecores: 'On newer CPUs that have both performance and efficiency cores, efficiency cores can be allocated as offload processors instead of normal (default) use. These e-cores can be allocated either for processing resampling filters, or for a generic DSP pool for performing other tasks such as convolution.',
  nblocks: 'Number of blocks to process at once. This setting can be used to fine tune CPU/GPU load to the lowest possible figure. When set to the default (0), the value is auto-configured based on the detected amount of CPU cache etc. Processing more blocks at once reduces overhead, especially when a GPU is used, while processing fewer blocks at once helps keep most of the data in CPU cache. Higher values are better suited for processors with a large cache, such as AMD 3D-series and some Intel Xeon models, or systems with high speed RAM, while smaller values are better suited for CPUs with a small cache, or systems with slower RAM.',
  upnp: 'Allows the entire track to be (pre-)fetched to memory at full network speed when the track size is known. This can cause a resource load spike when the fetch happens. It also has memory usage implications.',
  logEnabled: 'Log file can be enabled for troubleshooting purposes. After changing this setting, restart HQPlayer for the change to take full effect. If a log file is not defined, stderr output is used and captured to systemd journal when running as a service.',
  logPath: '[optional] Full path and name of the log file. If not defined, stderr output is used and captured to systemd journal when running as a service.',
  logTail: 'Live stream of the hqplayerd log (file or journal). Read-only.',
  showDesc: 'Show the description from the manual beside each setting. Disabling this converts those descriptions to hover tips.',
  keepOpt: 'Keep filter and DSD source option descriptions when setting descriptions are hidden',
  // v1 narrowbar Stages.js OPTION_STYLE_TIP (owner copy), verbatim.
  optStyle: "This feature reduces the mental load required to parse the signal chain options by stating each selection's properties in plain English. Items are categorized into families, optionally into variants, and listed by their distinguishing properties.",
  pinRates: 'Adds the capacity to pin a specific output rate without restarting the engine. Note: this will cause certain filters (integer- or 2x-upsampling only) to produce no output when mixing rate families! That is, certain filters cannot produce output with, e.g., a pinned 44.1k-family output rate and 48k-family source material.',   // owner copy
  apod: 'The Apodizing light flashes to indicate apodizing events. Brighter flashes indicate higher event density. When "Uncorrected events", half-corrected events (e.g., from a half-apodizing filter) occur at half-brightness.',
  // DRAFT (agent): the page's top section (main.js paintFill).
  fill: 'What the top of the page shows. Auto shows both: the Source spectrum, with the matrix profile picker on one line above it. Matrix profile shows the matrix engine at full size, with its response plot; Spectrum shows the spectrum alone. With the matrix engine bypassed, the spectrum shows either way.',
  bottom: 'Show the Setting Switcher for easy A/B comparisons (pick Volume from its dropdown for a volume slider), or hide the bottom bar entirely.',   // DRAFT (agent): the owner's line named a Volume bar option that is now a Setting Switcher target
  accent: 'Set the accent color of HQPTuner.',   // owner copy
  hideSpk: 'Hide the stages you don\'t use from the signal chain. Speakers is primarily for surround sound setups.',   // owner copy, reworded for v2 (four stages, not just Speakers)
  dyslexic: 'Use a dyslexic-friendly font (Atkinson Hyperlegible) for non-monospace text.',
  backup: 'Download a backup of the daemon\'s configuration, or restore one — served by hqplayerd\'s own /backup and /restore routes.',
};

const OFF_ON = [{ v: '0', label: 'Off' }, { v: '1', label: 'On' }];
const ON_OFF = [{ v: '1', label: 'On' }, { v: '0', label: 'Off' }];   // default leftmost where the default is On

// Gray reasons. CUDA devices: v1 disables both boxes while offload is off (no copy: blank reason grays without a line) and
// the DSP box under convolution-only (v1 copy). Log path: v1 gray.js.
const CONV_ONLY = 'Convolution-only offload uses the convolution device only.';
const LOG_OFF = 'Enable logging to set a log file path.';

export const TIMING_DRAWER = {
  id: 'timing', title: 'Timing', aria: 'Timing settings', restart: true,
  tabs: [{ id: 'timing', label: 'Timing', body: [
    { row: { label: 'Engine idle time', man: MAN.idle,
      control: { type: 'seg', id: 'idle', aria: 'Engine idle time', value: '0',
        // 6.0.4 form: value in ms, label in seconds (v1 schema unit: seconds).
        options: [{ v: '0', label: 'Default' }, ...[10, 20, 30, 60].map((s) => ({ v: String(s * 1000), label: String(s), unit: 's' }))] } } },
    { row: { label: 'Quick pause', man: MAN.quickPause,
      control: { type: 'seg', id: 'qpause', aria: 'Quick pause', value: '0', options: OFF_ON } } },
    { row: { label: 'Short buffer', man: MAN.shortBuffer,
      control: { type: 'seg', id: 'sbuf', aria: 'Short buffer', value: '0',
        options: [{ v: '0', label: 'Normal' }, { v: '1', label: 'Short' }, { v: '2', label: 'Minimum' }] } } },
  ] }],
};

// Apply to all stations: v1's `Apply to all presets` (SystemHardware.js, no copy of its own; `presets` →
// `stations`). Not a daemon setting: it widens the next Apply, so it never stages (live). Foot of both tabs, one value
// (MIRROR keeps the two in step).
const allStations = (id) => ({ row: { label: 'Apply to all stations', live: true, man: '',
  control: { type: 'seg', id, aria: 'Apply to all stations', value: '0', options: OFF_ON } } });
export const MIRROR = { hwallcpu: 'hwallgpu', hwallgpu: 'hwallcpu' };

export const HARDWARE_DRAWER = {
  id: 'hardware', title: 'Hardware acceleration', aria: 'Hardware acceleration settings', restart: true,
  // Two tabs, CPU | GPU (one panel ran 107px over at 1080×810 even with the copy in closer):
  // v1's own split of this card (the CPU pair + Blocks per cycle in one track, CUDA offload + devices in the other).
  tabs: [{ id: 'cpu', label: 'CPU', body: [
    { row: { label: 'Multicore DSP', man: MAN.multicore,
      control: { type: 'seg', id: 'multicore', aria: 'Multicore DSP', value: 'auto',
        options: [{ v: 'auto', label: 'Auto' }, { v: '1', label: 'Enabled' }, { v: '0', label: 'Disabled' }] } } },
    { row: { label: 'E-core allocation', man: MAN.ecores,
      control: { type: 'seg', id: 'ecores', aria: 'E-core allocation', value: 'default',
        options: [{ v: 'default', label: 'Disabled' }, { v: 'pool', label: 'DSP pool' }, { v: 'filter', label: 'Resampling' }] } } },
    // v1 BlocksPerCycleField (a slider again): `Set manually` → slider 1–16 (starts at 8);
    // off → 0, the daemon's auto-configuration, with v1's line.
    { row: { label: 'Blocks per cycle', man: MAN.nblocks,
      control: { type: 'slider', id: 'nblocks', value: 0, min: 1, max: 16, step: 1, aria: 'Blocks per cycle',
        auto: { v: 0, manual: 8, label: 'Set manually', note: 'Automatic — chosen from CPU cache size' } } } },
    allStations('hwallcpu'),
  ] }, { id: 'gpu', label: 'GPU', body: [
    { row: { label: 'CUDA offload', man: MAN.cuda,
      control: { type: 'seg', id: 'cuda', aria: 'CUDA offload', value: '0',
        options: [{ v: '0', label: 'Disabled' }, { v: '1', label: 'Full offload' }, { v: 'convolution', label: 'Convolution only' }] } } },
    { row: { label: 'CUDA devices', man: MAN.cudaDevs,
      control: { type: 'group', items: [
        { type: 'number', id: 'cudadev', label: 'DSP', value: -1, min: -1, max: 15, aria: 'CUDA device for DSP',
          gray: (v) => (v.cuda === '0' ? ' ' : v.cuda === 'convolution' ? CONV_ONLY : '') },
        { type: 'number', id: 'cudacdev', label: 'Convolution', value: -1, min: -1, max: 15, hint: '−1 = automatic', aria: 'CUDA device for convolution',
          gray: (v) => (v.cuda === '0' ? ' ' : '') },
      ] } } },
    allStations('hwallgpu'),
  ] }],
};

// UPnP. The 6.0.4 form's own `UPnP` item and v1's UPnP
// card: one row, http restore lane (restarts).
export const UPNP_DRAWER = {
  id: 'upnp', title: 'UPnP', aria: 'UPnP settings', restart: true,
  tabs: [{ id: 'upnp', label: 'UPnP', body: [
    { row: { label: 'UPnP freewheel', man: MAN.upnp,
      control: { type: 'seg', id: 'freewheel', aria: 'UPnP freewheel', value: '0', options: OFF_ON } } },
  ] }],
};

export const LOGGING_DRAWER = {
  id: 'logging', title: 'Logging', aria: 'Logging settings', restart: false,
  tabs: [{ id: 'logging', label: 'Logging', body: [
    { row: { label: 'Enable log', restart: true, man: MAN.logEnabled,
      control: { type: 'seg', id: 'logon', aria: 'Enable log', value: '1', options: OFF_ON } } },
    { row: { label: 'Log path', restart: true, man: MAN.logPath,
      control: { type: 'text', id: 'logpath', value: '/tmp/hqplayerd.log', maxlength: 256, aria: 'Log path',
        gray: (v) => (v.logon === '1' ? '' : LOG_OFF) } } },
    { block: 'logtail' },
  ] }],
};

// Behavior: HQPTuner prefs, live. One row left. v1's Auto-save (PendingBar) and the v2 draft's Live / Stage are gone
// (2026-10-03, the thread with Jussi): Apply writes the station and restarts, as the daemon's own config write does, so
// there is no applied-but-unsaved state for Auto-save to close, and live settings never touch the station (snapshots
// keep a live state), so there is nothing for Stage to hold.
export const BEHAVIOR_DRAWER = {
  id: 'behavior', title: 'Behavior', aria: 'Behavior settings', restart: false,
  tabs: [{ id: 'behavior', label: 'Behavior', body: [
    // Opt-in for the page's rate pins: the Output section exists only while On. HQPTuner pref, live.
    { row: { label: 'Allow pinned rates', live: true, man: MAN.pinRates,
      control: { type: 'seg', id: 'pinallow', aria: 'Allow pinned rates', value: '0', options: OFF_ON } } },
  ] }],
};

// v1 theme.js presets (labels + hex), amber = the v2 token. Custom hex overrides the preset until a swatch is picked again.
// Order: default leftmost: amber first, then v1's order.
export const ACCENTS = [
  { v: 'amber', label: 'Amber', hex: '#e9a63c' },
  { v: 'blue', label: 'Blue', hex: '#4f9dde' },
  { v: 'green', label: 'Phosphor green', hex: '#3fe0a0' },
  { v: 'violet', label: 'Violet', hex: '#a78bfa' },
];

// Two tabs: Display | Layout.
// Stages that can be hidden from the chain rail: DSD Processing, Speakers, Crossfeed, Loudness, DAC correction.
export const HIDEABLE = [
  { v: 'dsd', label: 'DSD Processing' },
  { v: 'speakers', label: 'Speakers' },
  { v: 'crossfeed', label: 'Crossfeed' },
  { v: 'loudness', label: 'Loudness' },
  { v: 'correction', label: 'DAC correction' },
];

export const VISUAL_DRAWER = {
  id: 'visual', title: 'Visual settings', aria: 'Visual settings', restart: false,
  tabs: [{ id: 'display', label: 'Display', body: [
    { row: { label: 'Setting descriptions', live: true, man: MAN.showDesc,
      control: { type: 'seg', id: 'vdesc', aria: 'Setting descriptions', value: '1', options: ON_OFF } } },
    { row: { label: 'Option descriptions', live: true, man: MAN.keepOpt,
      // v1: live only while Setting descriptions is off (the master forces them on); reads On meanwhile.
      control: { type: 'seg', id: 'vopt', aria: 'Option descriptions', value: '1', options: ON_OFF,
        gray: (v) => (v.vdesc === '1' ? ' ' : '') } } },
    // Option style (Display): v1's Standard | Simplified (narrow bar). Simplified = the plain titles the
    // mock shows; Standard = engine names. Mock acts on it (every chain select).
    { row: { label: 'Option style', live: true, man: MAN.optStyle,
      control: { type: 'seg', id: 'vstyle', aria: 'Option style', value: 'simplified',
        options: [{ v: 'standard', label: 'Standard' }, { v: 'simplified', label: 'Simplified' }] } } },
    // The lamp is permanent; the setting only picks what it flashes for. Two options → a seg.
    { row: { label: 'Apodizing indicator', live: true, man: MAN.apod,
      control: { type: 'seg', id: 'vapod', aria: 'Apodizing indicator', value: 'all',
        options: [{ v: 'all', label: 'All events' }, { v: 'uncorrected', label: 'Uncorrected events' }] } } },
    { row: { label: 'Dyslexic font', live: true, man: MAN.dyslexic,
      control: { type: 'seg', id: 'vdys', aria: 'Dyslexic font', value: '0', options: OFF_ON } } },
    { row: { label: 'Accent color', live: true, man: MAN.accent,
      control: { type: 'accent', id: 'vacc', aria: 'Accent color', value: 'amber', options: ACCENTS } } },
  ] }, { id: 'layout', label: 'Layout', body: [
    // Top of page: Auto (both: the spectrum, the Matrix section folded to its header line) | Matrix profile (the Matrix
    // section alone) | Spectrum (the spectrum alone). Label and copy DRAFT.
    { row: { label: 'Top of page', live: true, man: MAN.fill,
      control: { type: 'seg', id: 'vfill', aria: 'Top of page', value: 'auto',
        options: [{ v: 'auto', label: 'Auto' }, { v: 'profile', label: 'Matrix profile' }, { v: 'spectrum', label: 'Spectrum' }] } } },
    // Setting Switcher | None. Volume is a Setting Switcher target now (its slots become the volume bar).
    { row: { label: 'Bottom bar', live: true, man: MAN.bottom,
      control: { type: 'seg', id: 'vbottom', aria: 'Bottom bar', value: 'switcher',
        options: [{ v: 'switcher', label: 'Setting Switcher' }, { v: 'none', label: 'None' }] } } },
    // Independent toggles, one per hideable stage; lit = hidden.
    { row: { label: 'Hide from signal chain', live: true, full: true, man: MAN.hideSpk,   // full: five toggles, the copy under them
      control: { type: 'toggles', id: 'vhide', aria: 'Hide from signal chain', value: '', options: HIDEABLE } } },
  ] }],
};

// Signal path: every path HQPlayer can take, the one playing lit (components/signal-path.js). Read-only: nothing stages.
export const SIGPATH_DRAWER = {
  id: 'sigpath', title: 'Signal path', aria: 'Signal path', restart: false,
  tabs: [{ id: 'sigpath', label: 'Signal path', body: [{ block: 'sigpath' }] }],
};

// Rail: one entry per drawer, its settings as readouts (label | value), named as in the drawer. `wide` = value on its own
// line (a path). Values print the control's own option label.
export const SETTINGS_RAIL = [
  { id: 'timing', name: 'Timing', drawer: TIMING_DRAWER, show: ['idle', 'qpause', 'sbuf'] },
  { id: 'hardware', name: 'Hardware acceleration', drawer: HARDWARE_DRAWER, show: ['multicore', 'ecores', 'nblocks', 'cuda'] },
  { id: 'upnp', name: 'UPnP', drawer: UPNP_DRAWER, show: ['freewheel'] },
  { id: 'logging', name: 'Logging', drawer: LOGGING_DRAWER, show: ['logon', 'logpath'] },
  { id: 'behavior', name: 'Behavior', drawer: BEHAVIOR_DRAWER, show: ['pinallow'] },
  { id: 'visual', name: 'Visual settings', drawer: VISUAL_DRAWER, show: ['vdesc', 'vopt', 'vstyle', 'vapod', 'vdys', 'vacc', 'vfill', 'vbottom', 'vhide'] },
  // Readout: the path playing now (main.js `sigpath`), not a setting.
  { id: 'sigpath', name: 'Signal path', drawer: SIGPATH_DRAWER, show: [], live: 'Playing' },
];

// Rail readout labels where the drawer row label is long (same words, the drawer's own).
export const READOUT_LABEL = { vhide: 'Hidden', logpath: 'Log path', cudadev: 'DSP', cudacdev: 'Convolution' };

// Page: engine identity (GetInfo / GetLicense, v1 About card; values from the repo's 6.0.4 GetInfo fixture) +
// Backup / restore (v1 BackupRestoreRow), then About HQPTuner (owner copy, v1 SystemTab.js).
export const ABOUT = {
  rows: [
    ['Product', 'Signalyst HQPlayer Embedded'],
    ['Version', '6.0.4'],
    ['Engine', '6.0.4'],
    ['Licensed', 'TRUE'],
    ['Platform', 'Linux'],
  ],
  backup: MAN.backup,
  app: '2.0.0',
  prose: [
    'HQPTuner is a project by user oh shit, gorillas! to bring out the untapped UX potential of HQPlayer Embedded.',
    'Most credit goes to Jussi Laako/Signalyst. I\'m just plugging into what he does and trying to make it easy and pretty. Thanks, Jussi!',
    ['HQPTuner is free and always will be. If it enhances your audio experience, then it\'s done its job and a simple "thank you" is all the payment I need. That said, if you really want your specific "thank you" to be financial, I won\'t stop you from ',
      { a: 'buying me a coffee', href: 'https://ko-fi.com/ohshitgorillas' }, '. Just don\'t say I strong-armed you into it ;)'],
  ],
};

export const LOG_TAIL = {
  lines: 50,   // v1 LINES
  man: MAN.logTail,
  // Placeholder lines (v1's tests use the same shape); a real hqplayerd log sample replaces these.
  mock: Array.from({ length: 50 }, (_, i) => `log line ${i + 11}`),
};
