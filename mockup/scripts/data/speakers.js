// Speakers: HQPlayer's per-channel speaker processing (readme §1.9; manual §5 "Channel balance"): a master switch plus a
// level trim (dBFS) and a distance (cm) for each of the daemon's eight channel slots. Not part of the matrix engine:
// its own /speakers form, its own write (a form POST that reloads the engine, ~3 s: v1 components/speakers/Card.js), so
// its own apply group, not the matrix family's.
// Its rail stage sits before, and separate from, the Matrix engine; Crossfeed stays in the chain too.
// Strings: v1 Card.js (owner copy: card subtitle, speaker sets), manual §5 (verbatim), readme §1.9 channel order.
// Mock state: Speakers station, processing on, 2.0 set. Every slot carries a believable living-room distance, so any set
// draws a real room (fix the default speaker positions; at the daemon's 0 cm they piled onto the listener).

import { ENGAGE_BYPASS } from './matrix.js';

export const SETS = [   // v1 Card.js SETS (owner copy)
  { id: '2.0', label: '2.0 — stereo', channels: [0, 1] },
  { id: '2.1', label: '2.1 — stereo + sub', channels: [0, 1, 3] },
  { id: '3.0', label: '3.0 — stereo + center', channels: [0, 1, 2] },
  { id: '3.1', label: '3.1 — stereo + center + sub', channels: [0, 1, 2, 3] },
  { id: '5.1', label: '5.1 — surround', channels: [0, 1, 2, 3, 4, 5] },
  { id: '7.1', label: '7.1 — surround + sides', channels: [0, 1, 2, 3, 4, 5, 6, 7] },
];

export const SPEAKERS = {
  set: '2.0',
  // Daemon order (readme §1.9). The daemon calls slot 3 LFE; v1 shows it as Sub (display name only).
  channels: [
    { name: 'Left', short: 'L', level: 0, distance: 287 },
    { name: 'Right', short: 'R', level: -0.5, distance: 301 },
    { name: 'Center', short: 'C', level: 0, distance: 280 },
    { name: 'Sub', short: 'Sub', level: 0, distance: 330 },
    { name: 'Left rear', short: 'Lr', level: 0, distance: 240 },
    { name: 'Right rear', short: 'Rr', level: 0, distance: 240 },
    { name: 'Left side', short: 'Ls', level: 0, distance: 210 },
    { name: 'Right side', short: 'Rs', level: 0, distance: 210 },
  ],
  layout: [-30, 30, 0, -55, -145, 145, -90, 90],   // degrees clockwise from front (v1 Diagram.js)
  man: {
    speakers: [
      { text: 'Level trims each channel\'s output; distance delays the nearer speakers so every channel arrives at the listening position together.' },   // v1 owner copy
      { text: 'This method is suitable for simplest per-channel level adjustment and is processed in simpler and lighter way than full pipeline matrix.' },   // manual §5
      { text: 'Note! Distance processing is available also for bit-perfect pass-through of DSD when Direct SDM is enabled!' },   // manual §5
    ],
  },
};


export const SPEAKERS_DRAWER = {
  id: 'speakers', title: 'Speakers', aria: 'Speakers settings', restart: true,
  tabs: [{ id: 'speakers', label: 'Speakers', body: [
    { row: { label: 'Speakers', man: SPEAKERS.man.speakers,
      control: { type: 'seg', id: 'spken', aria: 'Speakers', value: '1', options: ENGAGE_BYPASS } } },
    { block: 'speakers' },
  ] }],
};
