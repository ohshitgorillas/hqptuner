// Builders and settings: the bodies that swap in for the chain (Settings, the Snapshot, Profile and Station builders),
// one body at a time.

import { closeSheets } from "../lib/shell/sheet.js";
import { loadValues } from "../components/drawers/drawer.js";
import { mountSettings } from "../components/settings/settings.js";
import { mountSnapshotBuilder } from "../components/builders/snapshot-builder.js";
import { mountProfileBuilder } from "../components/builders/profile-builder.js";
import { mountStationBuilder } from "../components/builders/station-builder.js";
import { SNAPSHOTS, MANY, MANY_STATIONS, LONG } from "../data/builders/snapshots.js";
import { PROFILES, STATION_PROFILES } from "../data/builders/profiles.js";
import { STATIONS } from "../data/builders/stations.js";
import { el } from "./markup.js";

/** @typedef {import("./state.js").App} App */
/** @typedef {import("./state.js").BodySwap} BodySwap */
/** @typedef {import("./state.js").Station} Station */
/** @typedef {ReturnType<typeof mountSettings>} Settings */
/** @typedef {Parameters<typeof mountSnapshotBuilder>} SnapshotArgs */
/** @typedef {import("../components/builders/profile-builder/records.js").Opts} ProfileOpts */
/** @typedef {Parameters<typeof mountStationBuilder>[2]} StationOpts */

/**
 * ── Settings (gear): swaps the body; header, engine row, Setting Switcher stay. ─────────────────────────────────
 *
 * @param {App} app
 * @returns {Settings}
 */
function wireSettings(app) {
  el("#gear").addEventListener("click", closeSheets); // the body swaps: no sheet stays over Settings
  // The gear from the Snapshot builder goes straight to Settings (one body at a time).
  el("#gear").addEventListener("click", () => {
    if (app.builder?.isOn()) app.builder.setOn(false, false);
    if (app.profiles?.isOn()) app.profiles.setOn(false, false);
    if (app.stationB?.isOn()) app.stationB.setOn(false, false);
  });
  return mountSettings(
    {
      gear: /** @type {HTMLButtonElement} */ (el("#gear")),
      chain: el("#body"),
      body: el("#sbody"),
      rail: el("#srail"),
      page: el("#spage"),
    },
    app.bus,
  );
}

/**
 * A Profile builder Save or Delete: the page's profile select follows the loaded station's profiles.
 *
 * @param {App} app
 * @returns {NonNullable<ProfileOpts["onSaved"]>}
 */
function profileSaved(app) {
  return (touched, rec, name, run) => {
    app.conn.applying();
    // Saved to the loaded station: it runs now (the restart Save causes, then the switch). The chain's Matrix engine family
    // takes its values as applied: drawers, rail lamps and values, the page section follow.
    if (run && rec) loadValues("matrix", rec.vals);
    // The page lists the loaded station's profiles (mock: the builder's records are the source).
    const home = /** @type {Station} */ (STATIONS.find((st) => st.active)).name;
    const mine = touched.find(([st]) => st === home);
    if (mine) {
      const mprof = app.mprof;
      const keep = mprof.value;
      app.fillProfiles(mine[1]);
      mprof.value = mine[1].includes(keep) ? keep : mine[1][0];
      if (run && rec) {
        mprof.value = /** @type {string} */ (name);
        mprof.dispatchEvent(new Event("change"));
      }
      if (rec && name === mprof.value) /** @type {HTMLTextAreaElement} */ (el("#mdesc")).value = rec.desc;
    }
  };
}

/**
 * ── Profile builder (Matrix engine section's button): swaps the body; the Matrix engine family on its own rail. ──────
 * Edits a copy; Save writes the profile and restarts the engine: the knob reads Applying….
 *
 * @param {App} app
 * @param {Settings} settings
 */
function wireProfiles(app, settings) {
  const { bus, plate } = app;
  const { PIPELINES, PIPELINES_DRAWER, FULL_FITS } = app.pipelines;
  app.profiles = mountProfileBuilder(
    {
      btn: el("#pbbtn"),
      chain: el("#body"),
      body: el("#pbody"),
      rail: el("#prail"),
      page: el("#ppage"),
      plate,
      settings,
      snapshot: () => /** @type {BodySwap} */ (app.builder),
      bus,
    },
    STATIONS,
    PROFILES,
    {
      running: () => app.mprof.value,
      level: () => app.level,
      levelBus: app.levelBus,
      fixed: () => app.fixedMode !== "off",
      pipelines: { PIPELINES, PIPELINES_DRAWER, FULL_FITS },
      onSaved: profileSaved(app),
    },
  );
  // The Snapshot builder's button from the Profile builder goes straight to it (one body at a time).
  el("#sbbtn").addEventListener("click", () => {
    const profiles = /** @type {BodySwap} */ (app.profiles);
    if (profiles.isOn()) profiles.setOn(false, false);
  });
}

/**
 * A Station builder Save or Delete: the header tree follows.
 *
 * @param {App} app
 * @returns {NonNullable<StationOpts["onSaved"]>}
 */
function stationSaved(app) {
  return ({ names, loaded, renamed, restart }) => {
    if (restart) app.conn.applying();
    const old = new Map(/** @type {Station[]} */ (app.treeStations).map((st) => [st.name, st]));
    app.treeStations = names.map((n) => {
      const was = old.get(n) ?? (renamed?.to === n ? old.get(renamed.from) : null);
      return { ...(was ?? { snapshots: [] }), name: n, active: n === loaded };
    });
    app.tree.refresh(app.treeStations);
  };
}

/**
 * ── Station builder (header button): swaps the body; the setup wizard's station walk, one station at a time. ────────
 * Edits a copy; Save writes the station (and the machine's hardware answers to every station). Saving the loaded station,
 * or new hardware answers, restarts the engine: the knob reads Applying…. The header tree follows saves and deletes (mock:
 * the Snapshot and Profile builders keep the stations they mounted with).
 *
 * @param {App} app
 * @param {Settings} settings
 */
function wireStations(app, settings) {
  const { bus, flags } = app;
  app.treeStations = STATIONS.map((st) => ({ ...st }));
  app.stationB = mountStationBuilder(
    {
      btn: el("#stbbtn"),
      chain: el("#body"),
      body: el("#stbody"),
      rail: el("#strail"),
      page: el("#stpage"),
      others: { settings, snapshot: () => app.builder, profiles: () => app.profiles },
      bus,
    },
    STATIONS,
    {
      flags,
      profilesOf: (st) => STATION_PROFILES(st),
      onRescan: () => app.conn.applying(),
      openProfiles: () => /** @type {BodySwap} */ (app.profiles).setOn(true),
      onSaved: stationSaved(app),
    },
  );
  // Another body's button from the Station builder goes straight to it (one body at a time).
  for (const b of ["#sbbtn", "#pbbtn"])
    el(b).addEventListener("click", () => {
      const stationB = /** @type {BodySwap} */ (app.stationB);
      if (stationB.isOn()) stationB.setOn(false, false);
    });
}

/**
 * Wire Settings and the three builders; app.builder, app.profiles, app.stationB and app.treeStations are set here.
 *
 * @param {App} app  the shared state (app/state.js)
 */
export function wireBuilders(app) {
  const { bus, flags } = app;
  const settings = wireSettings(app);

  // ── Snapshot builder (header button): swaps the body; the active station's snapshots. ─────────────────────────────
  /** @type {Record<App["flags"]["snapshots"], [SnapshotArgs[1], SnapshotArgs[2]]>} */
  const SNAPSHOT_SETS = { many: [MANY_STATIONS, MANY], long: [STATIONS, LONG], default: [STATIONS, SNAPSHOTS] };
  app.builder = mountSnapshotBuilder(
    {
      btn: el("#sbbtn"),
      chain: el("#body"),
      body: el("#bbody"),
      rail: el("#brail"),
      page: el("#bpage"),
      settings,
      bus,
    },
    ...SNAPSHOT_SETS[flags.snapshots],
    () => ({ ...app.liveNow, ...app.conversion.state() }),
  );

  wireProfiles(app, settings);
  wireStations(app, settings);
}
