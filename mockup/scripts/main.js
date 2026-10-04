// Faceplate entry point: one bus, the mock's URL flags and one shared state object, then each concern (scripts/app/)
// mounts its part onto the static markup in index.html, in mount order.

import { createBus } from "./lib/shell/bus.js";
import { hashFlags } from "./model/shell/flags.js";
import { SIZES } from "./lib/shell/plate.js";
import { pipelineSet } from "./data/stages/pipelines.js";
import { SCENES, SCENE0 } from "./data/shell/scenarios.js";
import { MOCK_ALERTS } from "./data/shell/alerts.js";
import { CONV } from "./data/stages/conversion.js";
import { MATRIX_PLOT } from "./data/stages/matrix.js";
import { VOLUME, VOLUME_RANGE } from "./data/stages/volume.js";
import { wireFrame } from "./app/frame.js";
import { wireSwitcher } from "./app/switcher.js";
import { wireEngine } from "./app/engine.js";
import { wireVolume } from "./app/volume.js";
import { wireOutput } from "./app/output.js";
import { wireMatrix } from "./app/matrix.js";
import { wireBuilders } from "./app/builders.js";
import { wireAlerts } from "./app/alerts.js";

// One bus for the components' announcements (lib/bus.js).
const bus = createBus();
// The mock's URL flags (model/flags.js), read once and passed down.
const flags = hashFlags(
  location.hash,
  SIZES,
  SCENES,
  MOCK_ALERTS.map((a) => a.kind),
);

// Everything the page changes as it runs. The data the page writes is copied in here and written here, never in data/.
const app = {
  bus,
  flags,
  pipelines: pipelineSet(flags),
  conv: { ...CONV }, // Output mode as the page holds it
  matrixPlot: { ...MATRIX_PLOT }, // `flat` follows the profile in focus
  volumeRange: { ...VOLUME_RANGE, loudness: { ...VOLUME_RANGE.loudness } }, // loudness as applied; openLoudness
  // What is playing: the scenario sets the source only; the path follows from the output mode, DSD playback and the
  // matrix gate as applied (conversion.js reports it, app/engine.js onPath).
  scene: SCENES.find((s) => s.id === (flags.scene ?? SCENE0)),
  mxApplied: true, // Matrix processing as applied (DSD metering needs it, protocol.md §7)
  spk: null, // Speakers drawer block (Direct: level column grays)
  meterHost: null, // Source drawer's meter block
  fillPref: "auto", // Visual settings → Layout (vfill): auto | profile | spectrum
  fillReady: false, // the matrix family is mounted (paintFill reads it)
  pmKey: "", // what the page meter shows now (remounts only when it changes)
  pinned: null, // a pinned rate {tier, fam} | null (page tuner, while Allow pinned rates is On)
  alerts: null, // the alerts' homes (components/alerts.js), mounted last
  picked: null, // the mock alert kinds picked
  vol: null, // the engine-row volume
  level: VOLUME.value, // the live volume level
  loudEngaged: VOLUME_RANGE.loudness.on, // Loudness's own gate (loudness in effect also needs the matrix engine)
  fixedMode: "off", // Volume → Fixed volume as applied (Profile builder: loudness can't adapt while it's on)
  // What the engine runs now, for the Snapshot builder's Live column (live lanes only: a snapshot holds nothing else).
  liveNow: { autopilot: "0", adaptive: "0", profile: "[Default]" },
  swStash: null, // the switcher slots' faces while the Output mode target borrows them
  outDrawer: null, // Output drawer (its Output mode row follows the mode, whoever moved it)
  builder: null, // Snapshot builder
  profiles: null, // Profile builder
  stationB: null, // Station builder
  treeStations: null, // the header tree's stations (Station builder saves and deletes)
  // Alerts raise only once their homes are mounted (app/alerts.js replaces this).
  raise: () => {},
};

wireFrame(app);
wireSwitcher(app);
wireEngine(app);
wireVolume(app);
wireOutput(app);
wireMatrix(app);
wireBuilders(app);
wireAlerts(app);
