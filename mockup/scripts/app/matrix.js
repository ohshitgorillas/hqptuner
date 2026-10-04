// Matrix and profiles: the page's Matrix profile select, the Matrix engine family's drawers (Matrix engine, DSP pipelines,
// Crossfeed, Loudness, DAC correction), the page's top section once the family is mounted, and the Speakers drawer that
// follows the family in #body.

import { $ } from '../lib/dom.js';
import { xrefGo } from '../lib/xref.js';
import { mountDrawer } from '../components/drawer.js';
import { createPipelines } from '../components/pipelines.js';
import { mountCrossfeed } from '../components/crossfeed.js';
import { mountLoudness } from '../components/loudness.js';
import { mountSpeakers } from '../components/speakers.js';
import { MATRIX_DRAWER, CROSSFEED_DRAWER, LOUDNESS_DRAWER, CORRECTION_DRAWER, CROSSFEED, LOUDNESS, XF_MODES, bypassed } from '../data/matrix.js';
import { SPEAKERS, SPEAKERS_DRAWER, SETS } from '../data/speakers.js';
import { MATRIX_PROFILES } from '../data/snapshots.js';
import { PROFILES } from '../data/profiles.js';
import { modeName } from '../model/crossfeed.js';
import { profileRecords } from '../model/app.js';

/**
 * Wire the Matrix profile select, the Matrix engine family and Speakers; app.mprof, app.fillProfiles, app.mxSection and
 * app.mxPick are set here, and app.fillReady turns on once the family is mounted.
 *
 * @param {object} app  the shared state (main.js)
 */
export function wireMatrix(app) {
  const { bus, stages, plate } = app;
  const { PIPELINES, PIPELINES_DRAWER, FULL_FITS } = app.pipelines;
  // Matrix profile (page select): the station's profiles (mock). MatrixSetProfile is live.
  const mprof = $('#mprof');
  app.mprof = mprof;
  app.fillProfiles = (names) => mprof.replaceChildren(...names.map((p) => new Option(p, p)));
  app.fillProfiles(MATRIX_PROFILES);
  mprof.addEventListener('change', () => {
    app.liveNow.profile = mprof.value; stages.get('matrix').querySelector('.v').textContent = mprof.value;
    // The picked profile's description (mock: its record's; the drawers keep their values, data/profiles.js).
    const [rec] = profileRecords(PROFILES, mprof.value);
    if (rec) $('#mdesc').value = rec.desc;
    app.paintFill();
  });

  // ── Matrix engine family: Matrix engine, Crossfeed, Loudness, DAC correction (DSP pipelines not drawn yet) ──────────
  // All four edit the matrix profile in focus: one value store, profile-wide staging, one Apply (drawer.js families).
  // Nothing here is live, so the rail follows on Apply (mock): each member's onApply reads the family's values.
  const railSet = (id, on, value) => {
    app.lamp(stages.get(id), on, value);
    bus.emit('relayout');   // rail wire redraws (an off parent's subtree loses its bus)
  };
  const mx = {};
  // Dependents follow the matrix engine: with Matrix processing bypassed, its children (DSP pipelines,
  // Crossfeed, Loudness) and DAC correction are not in effect, so their lamps go dark (their own settings are kept and
  // relight on re-engage), and the page's Matrix engine section leaves (the page shows engaged stages only).
  const mxOn = (v) => v.mxen === '1';
  app.mxSection = $('.sec[aria-label="Matrix profile"]');
  const mxDrawer = mountDrawer($('#body'), stages.get('matrix'), MATRIX_DRAWER, { ...mx,
    onApply: (v) => {
      railSet('matrix', mxOn(v));
      if (app.mxApplied !== mxOn(v)) { app.mxApplied = mxOn(v); app.paintMeter(); }
      app.paintFill();   // the page's top: Matrix section (fill / folded / gone) or the spectrum
    } });
  mxDrawer.setOpen(false);
  // DSP pipelines: Overview + one tab per output. A matrix-family member: its edits stage with the rest
  // of the profile. A tapped pin opens its output's tab.
  const plCore = createPipelines(PIPELINES, { bypassed, plate, openCrossfeed: () => xfDrawer.setOpen(true), goTab: (id) => plDrawer.showTab(id) });
  const plDrawer = mountDrawer($('#body'), stages.get('pipelines'), PIPELINES_DRAWER, { ...mx,
    blocks: Object.fromEntries([['pl-overview', plCore.overview], ...Array.from({ length: PIPELINES.outputs }, (_, o) => [`pl-out${o}`, plCore.output(o)])]),
    onApply: (v) => { plCore.sync(v); railSet('pipelines', mxOn(v), `${plCore.count()} active`); app.paintFill(); },
  });
  plDrawer.setOpen(false);
  if (!FULL_FITS) $('#drawer-pipelines').classList.add('pl-short');   // short channel names keep their case (Sub, Lr)
  const xfDrawer = mountDrawer($('#body'), stages.get('crossfeed'), CROSSFEED_DRAWER, { ...mx,
    blocks: { crossfeed: (host, ctx) => mountCrossfeed(host, CROSSFEED, ctx, bypassed) },
    onApply: (v) => {
      const m = v.xfmode;
      railSet('crossfeed', m !== 'off' && mxOn(v), modeName(XF_MODES, m));
      app.paintFill();
    },
  });
  xfDrawer.setOpen(false);
  const loud = app.volumeRange.loudness;
  const loudDrawer = mountDrawer($('#body'), stages.get('loudness'), LOUDNESS_DRAWER, { ...mx,
    blocks: { loudness: (host, ctx) => mountLoudness(host, LOUDNESS, ctx, { bypassed, level: app.level, levelBus: app.levelBus }) },
    onApply: (v) => {
      app.loudEngaged = v.ldon === '1';
      Object.assign(loud, { on: app.loudEngaged && mxOn(v), low: Number(v.ldrlow), high: Number(v.ldrhigh) });
      railSet('loudness', loud.on);
      app.levelBus.dispatchEvent(new CustomEvent('loudness'));
      app.loudValue(app.level);
      app.paintFill();
    },
  });
  loudDrawer.setOpen(false);
  app.volumeRange.openLoudness = () => loudDrawer.setOpen(true);   // Volume drawer's `Loudness ›` link
  const dcDrawer = mountDrawer($('#body'), stages.get('correction'), CORRECTION_DRAWER, { ...mx,
    onApply: (v) => { railSet('correction', v.dcen === '1' && mxOn(v), v.dcen === '1' ? (v.dcdac || '[none]') : 'Bypassed'); app.paintFill(); },
  });
  dcDrawer.setOpen(false);
  // The page's top section reads the whole family: paint it once everything is mounted.
  app.mxPick = app.mxSection.querySelector('.mstack > .inline');   // profile picker + Profile builder (moves to the header when folded)
  app.fillReady = true;
  app.paintFill();

  // ── Speakers ─────────────────────────────────────────────────────────────────
  // Speakers is not matrix processing: its own stage (before the Matrix engine), its own /speakers form and apply group.
  const spkStage = stages.get('speakers');
  const spkDrawer = mountDrawer($('#body'), spkStage, SPEAKERS_DRAWER, {
    blocks: { speakers: (host, ctx) => {
      app.spk = mountSpeakers(host, { ...SPEAKERS, sets: SETS }, ctx, (set) => {
        if (spkStage.querySelector('.lamp').classList.contains('on')) spkStage.querySelector('.v').textContent = set.label;
        spkStage.dataset.set = set.label;
      });
    } },
    onApply: (v) => railSet('speakers', v.spken === '1', v.spken === '1' ? spkStage.dataset.set : 'Bypassed'),
  });
  spkDrawer.setOpen(false);

  // ── Cross-references (data/xrefs.js): where each `Name ›` link lands. A link opens its drawer (one open at a time, as a
  // rail tap) on the tab or section that holds the fix.
  xrefGo('matrix', () => { mxDrawer.setOpen(true); mxDrawer.showTab('basic'); });   // Matrix processing
  // Matrix engine drawer intro (data/matrix.js MX_INTRO): the drawers it runs.
  xrefGo('drawer-pipelines', () => plDrawer.setOpen(true));
  xrefGo('drawer-crossfeed', () => xfDrawer.setOpen(true));
  xrefGo('drawer-loudness', () => loudDrawer.setOpen(true));
  xrefGo('drawer-correction', () => dcDrawer.setOpen(true));
}
