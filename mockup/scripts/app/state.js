// The shared state main.js builds and every scripts/app/ module wires onto: types only, nothing runs here.

/** @typedef {import("../lib/shell/bus.js").Bus} Bus */
/** @typedef {import("../model/shell/flags.js").Flags} Flags */
/** @typedef {import("../../../hqptuner/static/model/shell/app.js").SlotFace} SlotFace */

/** A scenario the mock can play (data/scenarios.js). @typedef {(typeof import("../data/shell/scenarios.js").SCENES)[number]} Scene */

/** @typedef {import("../components/drawers/drawer/state.js").DrawerApi} Drawer */

/** A chain's picks by stage: 1x filter, Nx filter, shaper. @typedef {{ "1x": string, nx: string, sh: string }} ChainPicks */

/**
 * What the engine runs now: the output mode, the running chain and both chains' picks.
 *
 * @typedef {object} ConvNow
 * @property {string} mode
 * @property {Mode} run
 * @property {ChainPicks} pcm
 * @property {ChainPicks} sdm
 */

/** A running chain: pcm | sdm. @typedef {import("../components/drawers/mode-drawer.js").Mode} Mode */

/**
 * The page's conversion chain (components/page/conversion.js).
 *
 * @typedef {object} Conversion
 * @property {(id: string, v: string) => void} update
 * @property {(m: string) => void} setMode
 * @property {(sc: Scene, dir?: boolean) => void} setScene
 * @property {() => Mode} running
 * @property {() => string} path
 * @property {() => ConvNow} state
 * @property {(api: { set(id: string, v: string): void, setRunning(m: Mode): void }) => void} bindDrawer
 * @property {(on: boolean) => void} setRoom
 * @property {() => void} refresh
 */

/** A body that swaps in for the chain: Settings or a builder. @typedef {{ isOn(): boolean, setOn(on: boolean, toChain?: boolean): void }} BodySwap */

/** The rail's stage buttons by id; the rail holds every stage the chain names. @typedef {{ get(id: string): HTMLButtonElement } & Map<string, HTMLButtonElement>} Stages */

/** A pinned output rate: its RATE_TIERS index and rate family. @typedef {{ tier: number, fam: "f44" | "f48" }} Pin */

/** A station in the header tree. @typedef {(typeof import("../data/builders/stations.js").STATIONS)[number]} Station */

/** @typedef {ReturnType<typeof import("../components/shell/volume.js").mountVolume>} Volume */
/** @typedef {ReturnType<typeof import("../components/drawers/speakers.js").mountSpeakers>} Speakers */
/** @typedef {ReturnType<typeof import("../components/shell/alerts.js").mountAlerts>} AlertHomes */
/** @typedef {ReturnType<typeof import("../components/shell/conn.js").mountConn>} Conn */
/** @typedef {ReturnType<typeof import("../components/shell/station-tree.js").mountStationTree>} StationTree */
/** @typedef {ReturnType<typeof import("../components/lists/option-list.js").mountOptionList>} OptionLists */
/** @typedef {ReturnType<typeof import("../data/stages/pipelines.js").pipelineSet>} PipelineSet */

/**
 * Everything the page changes as it runs: main.js builds the fields up to `raise`, each scripts/app/ module sets its own
 * in mount order. A field that opens null stays null until its module mounts it.
 *
 * @typedef {object} App
 * @property {Bus} bus
 * @property {Flags} flags
 * @property {PipelineSet} pipelines
 * @property {typeof import("../data/stages/conversion.js").CONV} conv  output mode as the page holds it
 * @property {typeof import("../data/stages/matrix.js").MATRIX_PLOT & { flat?: boolean }} matrixPlot  `flat` follows the profile in focus
 * @property {typeof import("../data/stages/volume.js").VOLUME_RANGE & { openLoudness?: () => void }} volumeRange
 * @property {Scene} scene  what is playing
 * @property {boolean} mxApplied  matrix processing as applied
 * @property {Speakers | null} spk  Speakers drawer block
 * @property {HTMLElement | null} meterHost  Source drawer's meter block
 * @property {string} fillPref  Visual settings → Layout (vfill): auto | profile | spectrum
 * @property {boolean} fillReady  the matrix family is mounted
 * @property {string} pmKey  what the page meter shows now
 * @property {Pin | null} pinned  a pinned rate, while Allow pinned rates is On
 * @property {AlertHomes | null} alerts  the alerts' homes, mounted last
 * @property {Set<string> | null} picked  the mock alert kinds picked
 * @property {Volume | null} vol  the engine-row volume
 * @property {number} level  the live volume level
 * @property {boolean} loudEngaged  Loudness's own gate
 * @property {string} fixedMode  Volume → Fixed volume as applied
 * @property {{ autopilot: string, adaptive: string, profile: string }} liveNow  what the engine runs now (live lanes)
 * @property {SlotFace[] | null} swStash  the switcher slots' faces while the Output mode target borrows them
 * @property {Drawer | null} outDrawer  Output drawer
 * @property {BodySwap | null} builder  Snapshot builder
 * @property {BodySwap | null} profiles  Profile builder
 * @property {BodySwap | null} stationB  Station builder
 * @property {Station[] | null} treeStations  the header tree's stations
 * @property {() => void} raise  raise the picked alerts onto their homes
 * @property {HTMLElement} plate  app/frame.js
 * @property {Stages} stages  app/frame.js
 * @property {(st: HTMLElement, on: boolean, value?: string) => void} lamp  app/frame.js
 * @property {Conn} conn  app/frame.js
 * @property {StationTree} tree  app/frame.js
 * @property {OptionLists} lists  app/frame.js
 * @property {() => void} swLight  app/switcher.js
 * @property {(v: number | null) => void} gaugeSet  app/engine.js
 * @property {() => void} paintMeter  app/engine.js
 * @property {() => void} paintFill  app/engine.js
 * @property {(p: string, run: string) => void} onPath  app/engine.js
 * @property {EventTarget} levelBus  app/engine.js
 * @property {Drawer} source  app/engine.js
 * @property {(v: number) => void} loudValue  app/volume.js
 * @property {Conversion} conversion  app/output.js
 * @property {HTMLSelectElement} mprof  app/matrix.js
 * @property {(names: string[]) => void} fillProfiles  app/matrix.js
 * @property {HTMLElement} mxSection  app/matrix.js
 * @property {HTMLElement} mxPick  app/matrix.js
 */

export {};
