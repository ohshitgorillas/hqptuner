// Builders and settings: the bodies that swap in for the chain (Settings, the Snapshot, Profile and Station builders),
// one body at a time.

import { $ } from '../lib/dom.js';
import { closeSheets } from '../lib/sheet.js';
import { loadValues } from '../components/drawer.js';
import { mountSettings } from '../components/settings.js';
import { mountSnapshotBuilder } from '../components/snapshot-builder.js';
import { mountProfileBuilder } from '../components/profile-builder.js';
import { mountStationBuilder } from '../components/station-builder.js';
import { SNAPSHOTS, MANY, MANY_STATIONS, LONG } from '../data/snapshots.js';
import { PROFILES, STATION_PROFILES } from '../data/profiles.js';
import { STATIONS } from '../data/stations.js';

/**
 * Wire Settings and the three builders; app.builder, app.profiles, app.stationB and app.treeStations are set here.
 *
 * @param {object} app  the shared state (main.js)
 */
export function wireBuilders(app) {
  const { bus, plate, flags } = app;
  // ── Settings (gear): swaps the body; header, engine row, Setting Switcher stay. ─────────────────────────────────
  $('#gear').addEventListener('click', closeSheets);   // the body swaps: no sheet stays over Settings
  // The gear from the Snapshot builder goes straight to Settings (one body at a time).
  $('#gear').addEventListener('click', () => { if (app.builder?.isOn()) app.builder.setOn(false, false); if (app.profiles?.isOn()) app.profiles.setOn(false, false); if (app.stationB?.isOn()) app.stationB.setOn(false, false); });
  const settings = mountSettings({ plate, gear: $('#gear'), chain: $('#body'), body: $('#sbody'), rail: $('#srail'), page: $('#spage') }, bus);

  // ── Snapshot builder (header button): swaps the body; the active station's snapshots. ─────────────────────────────
  const SNAPSHOT_SETS = { many: [MANY_STATIONS, MANY], long: [STATIONS, LONG], default: [STATIONS, SNAPSHOTS] };
  app.builder = mountSnapshotBuilder(
    { btn: $('#sbbtn'), chain: $('#body'), body: $('#bbody'), rail: $('#brail'), page: $('#bpage'), settings, bus },
    ...SNAPSHOT_SETS[flags.snapshots], () => ({ ...app.liveNow, ...app.conversion.state() }));

  // ── Profile builder (Matrix engine section's button): swaps the body; the Matrix engine family on its own rail. ──────
  // Edits a copy; Save writes the profile and restarts the engine: the knob reads Applying….
  const { PIPELINES, PIPELINES_DRAWER, FULL_FITS } = app.pipelines;
  app.profiles = mountProfileBuilder(
    { btn: $('#pbbtn'), chain: $('#body'), body: $('#pbody'), rail: $('#prail'), page: $('#ppage'), plate, settings, snapshot: () => app.builder, bus },
    STATIONS, PROFILES,
    { running: () => app.mprof.value, level: () => app.level, levelBus: app.levelBus, fixed: () => app.fixedMode !== 'off',
      pipelines: { PIPELINES, PIPELINES_DRAWER, FULL_FITS },
      onSaved: (touched, rec, name, run) => {
        app.conn.applying();
        // Saved to the loaded station: it runs now (the restart Save causes, then the switch). The chain's Matrix engine family
        // takes its values as applied: drawers, rail lamps and values, the page section follow.
        if (run && rec) loadValues('matrix', rec.vals);
        // The page lists the loaded station's profiles (mock: the builder's records are the source).
        const home = STATIONS.find((st) => st.active).name;
        const mine = touched.find(([st]) => st === home);
        if (mine) {
          const mprof = app.mprof;
          const keep = mprof.value;
          app.fillProfiles(mine[1]);
          mprof.value = mine[1].includes(keep) ? keep : mine[1][0];
          if (run && rec) { mprof.value = name; mprof.dispatchEvent(new Event('change')); }
          if (rec && name === mprof.value) $('#mdesc').value = rec.desc;
        }
      } });
  // The Snapshot builder's button from the Profile builder goes straight to it (one body at a time).
  $('#sbbtn').addEventListener('click', () => { if (app.profiles.isOn()) app.profiles.setOn(false, false); });

  // ── Station builder (header button): swaps the body; the setup wizard's station walk, one station at a time. ────────
  // Edits a copy; Save writes the station (and the machine's hardware answers to every station). Saving the loaded station,
  // or new hardware answers, restarts the engine: the knob reads Applying…. The header tree follows saves and deletes (mock:
  // the Snapshot and Profile builders keep the stations they mounted with).
  app.treeStations = STATIONS.map((st) => ({ ...st }));
  app.stationB = mountStationBuilder(
    { btn: $('#stbbtn'), chain: $('#body'), body: $('#stbody'), rail: $('#strail'), page: $('#stpage'),
      others: { settings, snapshot: () => app.builder, profiles: () => app.profiles }, bus },
    STATIONS,
    { flags,
      profilesOf: (st) => STATION_PROFILES(st),
      onRescan: () => app.conn.applying(),
      openProfiles: () => app.profiles.setOn(true),
      onSaved: ({ names, loaded, renamed, restart }) => {
        if (restart) app.conn.applying();
        const old = new Map(app.treeStations.map((st) => [st.name, st]));
        app.treeStations = names.map((n) => {
          const was = old.get(n) ?? (renamed?.to === n ? old.get(renamed.from) : null);
          return { ...(was ?? { snapshots: [] }), name: n, active: n === loaded };
        });
        app.tree.refresh(app.treeStations);
      } });
  // Another body's button from the Station builder goes straight to it (one body at a time).
  for (const b of ['#sbbtn', '#pbbtn']) $(b).addEventListener('click', () => { if (app.stationB.isOn()) app.stationB.setOn(false, false); });
}
