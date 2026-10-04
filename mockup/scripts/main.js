// Faceplate entry point: mount every component onto the static markup in index.html.

import { $, h } from './lib/dom.js';
import { mountPlate, setSize, sizeOf, SIZES, SIZE } from './lib/plate.js';
import { mountRail } from './components/rail.js';
import { mountSpeakers } from './components/speakers.js';
import { createPipelines } from './components/pipelines.js';
import { PIPELINES, PIPELINES_DRAWER, FULL_FITS } from './data/pipelines.js';
import { SPEAKERS, SPEAKERS_DRAWER, SETS } from './data/speakers.js';
import { mountStationTree } from './components/station-tree.js';
import { mountFilterPresets } from './components/filter-presets.js';
import { mountOptionList } from './components/option-list.js';
import { setListOpener } from './components/vselect.js';
import { setChain } from './lib/narrow.js';
import { closeSheets } from './lib/sheet.js';
import { FIELDS, CHAIN_NAMES, CATALOG } from './data/conversion.js';
import { mountDrawer } from './components/drawer.js';
import { mountSourceMeter } from './components/source-meter.js';
import { mountVolume, mountVolumeBar } from './components/volume.js';
import { mountMatrixPlot } from './components/matrix-plot.js';
import { mountVolumeRange } from './components/volume-range.js';
import { mountSwitcher } from './components/switcher.js';
import { mountConversion } from './components/conversion.js';
import { mountModeDrawer } from './components/mode-drawer.js';
import { setDacType } from './lib/dactype.js';
import { mountSettings } from './components/settings.js';
import { mountOutputTuner } from './components/output-tuner.js';
import { mountConn } from './components/conn.js';
import { mountSnapshotBuilder } from './components/snapshot-builder.js';
import { SNAPSHOTS, MATRIX_PROFILES, MANY, MANY_STATIONS, LONG } from './data/snapshots.js';
import { onApplied, familyOf } from './components/drawer.js';
import { mountProfileBuilder } from './components/profile-builder.js';
import { PROFILES, STATION_PROFILES } from './data/profiles.js';
import { mountStationBuilder } from './components/station-builder.js';

import { CHAIN } from './data/chain.js';
import { STATIONS } from './data/stations.js';
import { PRESETS } from './data/presets.js';
import { OUTPUT_DRAWER, BACKEND_NAMES, DEVICES, RATE_TIERS } from './data/output.js';
import { SOURCE_DRAWER, METER } from './data/source.js';
import { HF_DRAWER } from './data/hf.js';
import { VOLUME, VOLUME_DRAWER, VOLUME_RANGE } from './data/volume.js';
import { MATRIX_PLOT, MATRIX_DRAWER, CROSSFEED_DRAWER, LOUDNESS_DRAWER, CORRECTION_DRAWER, CROSSFEED, LOUDNESS, bypassed } from './data/matrix.js';
import { mountCrossfeed } from './components/crossfeed.js';
import { mountLoudness } from './components/loudness.js';
import { CONV, MODE_DRAWERS } from './data/conversion.js';
import { SCENES, SCENE0, ENGINE, ZONES, OUT, COPY } from './data/scenarios.js';
import { mountScenario, sceneFromHash, mountAlertPicker, mountSizePicker } from './components/scenario.js';
import { mountAlerts } from './components/alerts.js';
import { ALERT_COPY, MOCK_ALERTS, MOCK_FIG } from './data/alerts.js';
import { LISTS } from './data/option-lists.js';
import { xrefGo, withXref } from './lib/xref.js';

const plate = $('#plate');
mountPlate(plate);

const stages = mountRail($('#rail'), CHAIN);

// ── Mock scenario: what is playing (switch above the plate; data/scenarios.js) ──────────────────────────────────────
// The scenario sets the source only. The path follows from the output mode, DSD playback (Direct SDM) and the matrix gate
// as applied; conversion.js works it out and reports it (onPath), and everything that shows playback follows here.
let scene = SCENES.find((s) => s.id === sceneFromHash(SCENES, SCENE0));
let mxApplied = true;      // Matrix processing as applied (DSD metering needs it, protocol.md §7)
let spk = null;            // Speakers drawer block (Direct: level column grays)
let meterHost = null;      // Source drawer's meter block
const BYPASS = ['hf', 'volume', 'matrix', 'pipelines', 'crossfeed', 'loudness', 'resampling', 'shaping', 'correction'];
const gauge = { ndl: $('.gauge .ndl'), val: $('.gauge .val') };
const bufs = [...document.querySelectorAll('.engine .meter')];
/** Red | amber | green by the seams [bad|warn, warn|ok]; null (nothing playing) = no zone (neutral). */
const zone = (v, [lo, hi]) => (v == null ? '' : v < lo ? 'bad' : v < hi ? 'warn' : 'ok');
/** Process speed gauge: × on a log scale, 1× at the warn | ok seam; nothing playing rests the needle at the left stop.
 *  The figure takes the zone colour its needle sits in. */
function gaugeSet(v) {
  const th = (v == null ? 180 : Math.max(0, Math.min(180, 107.2 - 74.7 * Math.log2(v)))) * Math.PI / 180;
  gauge.ndl.setAttribute('x2', (55 + 44 * Math.cos(th)).toFixed(1));
  gauge.ndl.setAttribute('y2', (54 - 44 * Math.sin(th)).toFixed(1));
  gauge.val.textContent = v == null ? '—' : v.toFixed(2) + '×';
  gauge.val.dataset.zone = zone(v, ZONES.speed);
}
/** Source meter: the source's own rate (DSD at its base rate); v1's owner copy where there is no stream. */
function paintMeter() {
  if (!meterHost) return;
  meterHost.replaceChildren();
  const why = !scene.playing ? COPY.meterIdle : scene.family === 'dsd' && !mxApplied ? COPY.meterDsd : null;
  if (why) meterHost.append(h('div.mnone', {}, h('p', {}, withXref(why))));
  else mountSourceMeter(meterHost, { ...METER, nyquist: scene.nyquist, brick: scene.brick, dsdNoise: scene.family === 'dsd' });
  paintFill();
}
/**
 * The page's top section (the fill): Source spectrum and / or the Matrix engine section.
 *   Top of page (Visual settings → Layout, vfill): auto | profile | spectrum.
 *   auto      both: the spectrum takes the fill, the Matrix section folds to its header line (profile picker + Profile
 *             builder) while the matrix engine is engaged, so a profile is one tap away (A/B flat vs EQ'd).
 *   profile   the Matrix section at full size, no spectrum. Bypassed, there is no profile: the spectrum takes the fill.
 *   spectrum  the spectrum, no Matrix section.
 * Bypassed, no Matrix section either way (engaged stages only).
 * Spectrum: full at 13″, slim (strip + bars, no heads or table) at 10.2″ / 11″ (lib/plate.js SIZES meter). Same no-stream
 * lines as the Source drawer's (DSD needs the matrix engine engaged).
 */
const pmSec = $('.sec.psrc'), pmHost = $('#pmeter');
let fillPref = 'auto';
let fillReady = false;     // the matrix family is mounted (paintFill reads it)
let pmKey = '';            // what the page meter shows now (remounts only when it changes)
window.addEventListener('vfill', (e) => { fillPref = e.detail; paintFill(); });
function paintFill() {
  if (!fillReady) return;
  const profile = mxApplied && fillPref === 'profile';               // the Matrix section has the top
  const fold = mxApplied && fillPref === 'auto';                     // both: the Matrix section on one line
  const flat = Object.values(PROFILES).some((st) => st[mprof.value]?.flat);   // mock: the plot of a profile that changes nothing
  // Matrix section: the top (fill) | folded to its header line | hidden (bypassed, or Spectrum).
  const mxHead = mxSection.querySelector(':scope > .sh'), mxTwo = mxSection.querySelector(':scope > .two');
  mxSection.hidden = !(profile || fold);
  mxSection.classList.toggle('fill', profile);
  mxSection.classList.toggle('mxfold', fold);
  if (fold) mxHead.append(mxPick); else mxSection.querySelector('.mstack').prepend(mxPick);
  mxTwo.hidden = fold;
  if (MATRIX_PLOT.flat !== flat) MATRIX_PLOT.flat = flat;
  // Source spectrum: whenever the Matrix section isn't the top.
  const show = !profile;
  pmSec.classList.toggle('slim', sizeOf(SIZE).meter === 'slim');
  pmSec.hidden = !show;
  const why = !show ? 'off' : !scene.playing ? COPY.meterIdle : scene.family === 'dsd' && !mxApplied ? COPY.meterDsd : null;
  const key = `${why}|${scene.id}`;
  if (key !== pmKey) {
    pmKey = key;
    pmHost.replaceChildren();   // a running meter stops once its block leaves the host
    if (show && why) pmHost.append(h('div.mnone', {}, h('p', {}, withXref(why))));
    else if (show) mountSourceMeter(pmHost, { ...METER, compact: true, nyquist: scene.nyquist, brick: scene.brick, dsdNoise: scene.family === 'dsd' });
  }
  window.dispatchEvent(new Event('resize'));   // the page refits (conversion.js fit), the matrix plot redraws
}
function onPath(p, run) {
  const e = ENGINE[p];
  gaugeSet(e?.speed);
  bufs.forEach((m, i) => {
    const v = e ? [e.in, e.out][i] : 0;
    m.querySelector('.fill').style.width = v + '%';
    m.querySelector('.mv').textContent = v + '%';
    m.dataset.zone = zone(e ? v : null, ZONES.buffer);
  });
  stages.get('source').querySelector('.v').textContent = scene.playing ? scene.source : '—';
  const direct = p === 'direct';
  // Not in this track's path: Direct runs nothing but Speakers (Resampling and Shaping leave the chain on DSD → DSD).
  const out = direct ? BYPASS : [];
  for (const id of BYPASS) stages.get(id).classList.toggle('byp', out.includes(id));
  vol?.setDirect(direct, COPY.directVolume);
  spk?.direct(direct, COPY.directSpeakers);
  $('#drawer-output .dial')?._setPlaying(p === 'idle' ? null : direct ? OUT.direct.tier : OUT[run].tier);
  paintMeter();
  raise();
  window.dispatchEvent(new CustomEvent('sigpath', { detail: { p, stage: scene.stage || '1x' } }));   // Settings → Signal path
  window.dispatchEvent(new Event('resize'));   // rail wire redraws (taps follow the lamps)
}
// PCM output bit depth = the Output drawer's DAC bits (the dithering level) for the active backend, as applied. Omitted at
// 0 (auto-detect: the engine picks it) and on Combo (one value per sub-device).
const dacBitsRow = (be) => OUTPUT_DRAWER.tabs[0].body.find((it) => it.group === be)?.rows.find((r) => r.label === 'DAC bits')?.control;
const outFmt = { backend: OUTPUT_DRAWER.backend, bits: { network: dacBitsRow('network').value, alsa: dacBitsRow('alsa').value } };
const pcmBits = () => { const b = Number(outFmt.bits[outFmt.backend]); return b > 0 ? ` / ${b}bit` : ''; };
// Shaping drawer, PCM out: what the dither targets, read off the Output drawer (DRAFT copy).
const dithNote = () => { const b = Number(outFmt.bits[outFmt.backend]); return b > 0 ? `Dithers to ${b} bits (DAC bits)` : 'Dithers to the bit depth the DAC reports (DAC bits: auto-detect)'; };
// A pinned rate (page tuner, while Allow pinned rates is On): the output plays it (mock), whatever the source.
let pinned = null;   // {tier, fam} | null
/** What the output carries: tier playing (RATE_TIERS index), exact rate, the rest (bits · channels), the rail value. */
const outFor = (run, p, sc) => {
  if (p === 'idle') return { tier: null, rate: '—', rest: '', value: '—' };
  let tier, rate, bits;
  if (p === 'direct') [tier, rate, bits] = [OUT.direct.tier, OUT.direct.rate.f44, '1bit'];
  else if (pinned && RATE_TIERS.tiers[pinned.tier].family === run) { const t = RATE_TIERS.tiers[pinned.tier]; [tier, rate] = [pinned.tier, `${t[pinned.fam]} ${t.unit}`]; }
  else [tier, rate] = [OUT[run].tier, OUT[run].rate[sc.fam]];
  if (p !== 'direct') bits = run === 'sdm' ? '1bit' : pcmBits().replace(' / ', '');
  return { tier, rate, rest: [bits, '2ch'].filter(Boolean).join(' · '), value: [rate, bits, '2ch'].filter(Boolean).join(' / ') };
};
mountScenario($('#scene'), SCENES, scene.id, (id) => { scene = SCENES.find((s) => s.id === id); conversion.setScene(scene); });
// Mock alerts (picker beside Scenario; data/alerts.js). raise() turns the picks into alerts where v1's would fire, onto
// their homes (components/alerts.js, mounted last); every path change re-raises.
let alerts = null;
let picked = mountAlertPicker($('#scene'), MOCK_ALERTS, (k) => { picked = k; raise(); });
// Mock display size (third group on the strip): the plate re-lays out at that iPad's landscape points (lib/plate.js).
// 13″ also opens both Resampling filters (the idle one too) rather than stretch the Matrix section (SIZES both).
mountSizePicker($('#scene'), SIZES, SIZE, (id) => { conversion.setRoom(!!sizeOf(id).both); setSize(id); paintFill(); });
const clipCtr = { lamp: $('.engine .counter .lamp'), n: $('.engine .counter .cnt') };
const clip0 = { bad: clipCtr.lamp.classList.contains('bad'), n: clipCtr.n.textContent };
function raise() {
  if (!alerts) return;
  const p = conversion.path(), run = conversion.running(), st = conversion.state();
  const playing = p !== 'idle';
  const on = (k) => picked.has(k);
  const A = [];
  if (on('credentials')) A.push({ kind: 'credentials', sev: 'crit', text: ALERT_COPY.credentials });
  if (playing && on('speed')) A.push({ kind: 'speed', sev: 'crit', text: ALERT_COPY.speedCrit(MOCK_FIG.speed) });
  if (playing && on('clip')) A.push({ kind: 'clip', sev: 'warn', text: ALERT_COPY.clip(MOCK_FIG.clips) });
  // Apodizing: only where a filter runs (not a DSD → SDM path); names the running filter, as v1 does.
  // v1 health.js: only when the running filter is non-apodizing (silent for an unknown one).
  const rf = stages.get('resampling').querySelector('.v').textContent;
  const rfApod = LISTS[run + 'Filters']?.find((o) => o.v === rf)?.f?.apod;
  if (playing && on('apod') && !['sdm-sdm', 'direct'].includes(p) && rfApod === null) {
    A.push({ kind: 'apod', sev: 'warn', text: ALERT_COPY.apod(12, rf) });
  }
  // Shaper fit: judged in the family that will produce output (v1 shaperfit.js), playing or not.
  if (on('shaperSdm') && run === 'sdm') A.push({ kind: 'shaperSdm', sev: 'crit', text: ALERT_COPY.shaperSdm(st.sdm.sh, 'DSD256') });
  if (on('shaperPcm') && run === 'pcm') A.push({ kind: 'shaperPcm', sev: 'warn', text: ALERT_COPY.shaperPcm(st.pcm.sh, '2x', '4x') });
  if (playing && on('roon')) A.push({ kind: 'roon', sev: 'warn', text: ALERT_COPY.roonIdle });
  // Junk advice: Nx PCM content only (the HF filter can't be engaged at 1x rates): fake hi-res, junk above the 44.1k fold.
  if (playing && on('junk') && scene.family === 'pcm' && scene.stage === 'nx') {
    A.push({ kind: 'junk', sev: 'advice', text: ALERT_COPY.junk20k(21.6, Math.round(scene.nyquist / 500)) });
  }
  // The engine row reads what the raised alerts read (mock figures), else the path's own.
  const sp = A.some((a) => a.kind === 'speed');
  gaugeSet(sp ? MOCK_FIG.speed : ENGINE[p]?.speed);
  const cl = A.some((a) => a.kind === 'clip');
  clipCtr.lamp.classList.toggle('bad', cl || clip0.bad);
  clipCtr.n.textContent = cl ? `${MOCK_FIG.clips} this track` : clip0.n;
  alerts.set(A);
}
// Brand knob = connection lamp; every drawer Apply restarts the engine (mock: the knob reads Applying… for a moment).
const conn = mountConn($('#conn'));
onApplied(() => conn.applying());
const tree = mountStationTree($('#station-host'), STATIONS);
// Option lists: every chain filter / dither / modulator picker (page, Resampling · Shaping drawer, Setting Switcher slots)
// opens its whole list, narrowing built into its head: filters in a bottom sheet, modulators and dithers in a panel at the
// picker (trigger).
const lists = mountOptionList(plate);
setListOpener((o) => {
  const k = o.field.slice(3);
  const f = k === 'sh' ? FIELDS[o.chain + 'sh'] : FIELDS[k];
  lists.open({ ...o, title: f.label, sub: f.sub, band: CHAIN_NAMES[o.chain] });
});
mountFilterPresets(plate, $('#fpbtn'), PRESETS);
mountMatrixPlot($('#mplot'), MATRIX_PLOT);
mountSwitcher($('.slots'), (slot, target) => {
  // A slot's ▾: its picker is the target's list (running chain). Matrix profile has no list sheet.
  const run = conversion.running();
  const field = { '1x filter': '1x', 'Nx filter': 'nx', Modulator: 'sh' }[target];
  if (!field) return;
  const list = field === 'sh' ? (run === 'sdm' ? 'modulators' : 'dithers') : run + 'Filters';
  const cat = CATALOG[list];
  const f = field === 'sh' ? FIELDS[run + 'sh'] : FIELDS[field];
  lists.open({ trigger: slot, list, stage: field === 'nx' ? 'nx' : '1x', chain: run, value: slot.querySelector('.l').textContent,
    title: f.label, sub: f.sub, band: CHAIN_NAMES[run],
    onPick: (v) => { slot.querySelector('.l').textContent = v; slot.querySelector('.v').textContent = cat.find((o) => o.v === v)?.label ?? v; } });
});
// Live level → Range bar needle.
const levelBus = new EventTarget();
var vol = mountVolume(plate, { down: $('#vol-dn'), readout: $('#vol-rd'), up: $('#vol-up') }, stages.get('volume'), VOLUME, levelBus, VOLUME_RANGE.loudness);
mountVolumeBar($('#vbar'), vol, VOLUME, levelBus, VOLUME_RANGE.loudness);   // bottom-bar home: the Setting Switcher's Volume target
// Loudness rail value: share of the maximum shelving applied at the live volume (v1 eqlab shelfScale): full at/below the
// range's lower bound, none at/above its upper bound, linear between. Owner copy: `x% applied`.
const loud = VOLUME_RANGE.loudness;
const shelf = (v) => (loud.high <= loud.low ? (v <= loud.low ? 1 : 0) : Math.max(0, Math.min(1, (loud.high - v) / (loud.high - loud.low))));
let level = VOLUME.value;
// loud.on = loudness in effect (engaged AND the matrix engine running); loudEngaged = its own gate. Bypassed matrix:
// the value reads what is applied, 0% (dependents follow the matrix bypass).
let loudEngaged = loud.on;
const loudValue = (v) => { stages.get('loudness').querySelector('.v').textContent = loudEngaged ? `${Math.round((loud.on ? shelf(v) : 0) * 100)}% applied` : 'Off'; };
levelBus.addEventListener('level', (e) => { level = e.detail; loudValue(level); });
loudValue(VOLUME.value);

// What the engine runs now, for the Snapshot builder's Live column (live lanes only: a snapshot holds nothing else).
let fixedMode = 'off';   // Volume → Fixed volume as applied (Profile builder: loudness can't adapt while it's on)
const liveNow = { autopilot: '0', adaptive: '0', profile: '[Default]' };
// Matrix profile (page select): the station's profiles (mock). MatrixSetProfile is live.
const mprof = $('#mprof');
mprof.replaceChildren(...MATRIX_PROFILES.map((p) => new Option(p, p)));
mprof.addEventListener('change', () => {
  liveNow.profile = mprof.value; stages.get('matrix').querySelector('.v').textContent = mprof.value;
  // The picked profile's description (mock: its record's; the drawers keep their values, data/profiles.js).
  const rec = Object.values(PROFILES).map((st) => st[mprof.value]).find(Boolean);
  if (rec) $('#mdesc').value = rec.desc;
  paintFill();
});

const source = mountDrawer($('#body'), stages.get('source'), SOURCE_DRAWER, {
  blocks: { meter: (host) => { meterHost = host; paintMeter(); } },
});
// HF filter: the filter is live, so the rail lamp and value follow it at once (engine name, or Inactive at none).
// Setting the filter by hand switches auto-pilot off (backend rule, architecture §9.3).
const hfStage = stages.get('hf');
const hf = mountDrawer($('#body'), hfStage, HF_DRAWER, {
  on: {
    hfsel: (v) => {
      const on = v !== 'none';
      hfStage.classList.toggle('off', !on);
      hfStage.querySelector('.lamp').classList.toggle('on', on);
      hfStage.querySelector('.v').textContent = on ? v : 'Inactive';
      hf.set('hfauto', '0');
      liveNow.autopilot = '0';
    },
    hfauto: (v) => { liveNow.autopilot = v; },
  },
});
hf.setOpen(false);
const volDrawer = mountDrawer($('#body'), stages.get('volume'), VOLUME_DRAWER, {
  blocks: { range: (host, ctx) => mountVolumeRange(host, VOLUME_RANGE, ctx, levelBus) },
  // Fixed volume is a restart row: the readouts and ± follow it on Apply.
  onApply: (v) => { fixedMode = v.vfixmode; vol.setFixed(v.vfixmode, v.vlevel, v.viso); },
  on: { vadapt: (v) => { liveNow.adaptive = v; } },   // live lane
});
volDrawer.setOpen(false);
// Resampling · Shaping: one drawer opened from both stages; the filters + shaper also live on the page (two homes, one
// state). Page picks reach the drawer through drawer.set; drawer picks reach the page + rail through `on`.
// Setting Switcher → Output mode: the two slots are the two bands, PCM | SDM (DSD) (no list: ▾ hides). A slot going live
// sets the mode (live); the mode moving elsewhere (band switch, snapshot) lights its slot. Other targets get their slots back.
const swSel = $('#swtarget');
const swSlots = [...document.querySelectorAll('.slots .slot')];
// Slot faces (owner copy): the names spelled out, centred; SDM carries its better-known name under it.
const MODES = [['pcm', 'Pulse Code Modulation (PCM)', ''], ['sdm', 'Sigma Delta Modulation (SDM)', 'aka DIRECT STREAM DIGITAL (DSD)']];
let swStash = null;
function swLight() {
  if (swSel.value !== 'Output mode') return;
  const i = MODES.findIndex(([m]) => m === conversion.state().mode);   // a daemon in Auto: no slot moves
  const b = swSlots[i]?.querySelector('.sbody');
  if (b && b.getAttribute('aria-checked') !== 'true') b.click();
}
swSlots.forEach((s, i) => s.querySelector('.sbody').addEventListener('click', () => {
  if (swSel.value === 'Output mode') conversion.setMode(MODES[i][0]);
}));
// Volume target: the slots give way to the volume bar (moved into the switcher), the engine-row volume hides.
$('.switcher').append($('#vbar'));
swSel.addEventListener('change', () => {
  plate.dataset.sw = swSel.value === 'Volume' ? 'volume' : '';
  window.dispatchEvent(new Event('resize'));
  const on = swSel.value === 'Output mode';
  if (on && !swStash) {
    swStash = swSlots.map((s) => ({ l: s.querySelector('.l').textContent, v: s.querySelector('.v').textContent, on: s.classList.contains('on') }));
    swSlots.forEach((s, i) => {
      s.classList.add('mode');
      s.querySelector('.l').textContent = '';
      s.querySelector('.v').textContent = MODES[i][1];
      s.querySelector('.tx').append(h('span.aka', { text: MODES[i][2] }));
      s.querySelector('.spick').hidden = true;
    });
    swLight();
  } else if (!on && swStash) {
    const was = swStash;
    swStash = null;
    swSlots.forEach((s, i) => { s.classList.remove('mode'); s.querySelector('.aka')?.remove(); s.querySelector('.l').textContent = was[i].l; s.querySelector('.v').textContent = was[i].v; s.querySelector('.spick').hidden = false; });
    swSlots[Math.max(0, was.findIndex((x) => x.on))].querySelector('.sbody').click();
  }
});

let outDrawer = null;   // Output drawer (its Output mode row follows the mode, whoever moved it)
// Output: the rate picker (pins on the running band), only while Allow pinned rates is On. No mode control.
const tuner = mountOutputTuner($('#oglass'), RATE_TIERS, { onPin: (pin) => { pinned = pin; conversion.refresh(); } });
// Mock: `#mode-auto` = the daemon left in Auto ([source]) by another client; HQPTuner doesn't offer it, only reads it.
if (location.hash.includes('mode-auto')) CONV.mode = 'auto';
const conversion = mountConversion(
  { rs: $('#rs-body'), sh: $('#sh-body'), stages, onOut: (o) => { tuner.set({ run: o.run, tier: o.tier, src: scene.playing ? scene.tier : null, fam: scene.fam || 'f44' }); swLight(); outDrawer?.set('omode', o.mode); }, onRun: (run) => { setChain(run); raise(); }, onPath },
  CONV, outFor, scene,
);
conversion.setRoom(!!sizeOf(SIZE).both);   // opened on 13″ (#size-13): both filters open from the start
// DSD Processing, Resampling, Shaping: one drawer per stage, PCM out | SDM out tabs (components/mode-drawer.js). Filters and
// shapers are live with two homes (page + drawer); the rest stage. A facade lets the page and the mode switch reach all three.
const modeDrawer = (k, onApplied) => mountModeDrawer($('#body'), MODE_DRAWERS[k].stages.map((id) => stages.get(id)), MODE_DRAWERS[k], CONV.values,
  { running: conversion.running(), on: (id, v) => (DAC_PREF[id] ? setDacType(DAC_PREF[id], v) : conversion.update(id, v)), onApplied });
const DAC_PREF = { dacr2r: 'r2r', dacess: 'ess' };   // Shaping's DAC type rows: HQPTuner prefs that fold the shaper lists
const dsdDrawer = modeDrawer('dsd', (v) => {   // restart: the rail value follows, DSD playback sets the path
  for (const id of ['integ', 'decim', 'noise', 'sgain']) conversion.update(id, v[id]);
  conversion.setScene(scene, v.dsdplay === '1');
});
const rsDrawer = modeDrawer('resampling', (v) => conversion.update('sdmconv', v.sdmconv));
const shDrawer = modeDrawer('shaping');
shDrawer.note('dithto', dithNote());
const modeDrawers = [dsdDrawer, rsDrawer, shDrawer];
conversion.bindDrawer({
  set: (id, v) => { for (const d of modeDrawers) d.set(id, v); },
  setRunning: (m) => { for (const d of modeDrawers) d.setRunning(m); },
});
outDrawer = mountDrawer($('#body'), stages.get('output'), OUTPUT_DRAWER, {
  groupNames: BACKEND_NAMES, devices: DEVICES, rateTiers: RATE_TIERS,
  on: { omode: (v) => conversion.setMode(v) },   // live: the page, rail and Setting Switcher follow at once
  // DAC bits restart: the rail's Output value and the Shaping drawer's dither line follow on Apply.
  onApply: (v) => {
    Object.assign(outFmt, { backend: v.backend ?? outFmt.backend, bits: { network: v.netbits ?? outFmt.bits.network, alsa: v.alsabits ?? outFmt.bits.alsa } });
    conversion.refresh();
    shDrawer.note('dithto', dithNote());
  },
});
outDrawer.setOpen(false);
outDrawer.set('omode', conversion.state().mode);
// Settings → Behavior → Allow pinned rates (settings.js effect).
window.addEventListener('pinallow', (e) => { tuner.allow(e.detail); });

// ── Matrix engine family: Matrix engine, Crossfeed, Loudness, DAC correction (DSP pipelines not drawn yet) ──────────
// All four edit the matrix profile in focus: one value store, profile-wide staging, one Apply (drawer.js families).
// Nothing here is live, so the rail follows on Apply (mock): each member's onApply reads the family's values.
const railSet = (id, on, value) => {
  const st = stages.get(id);
  st.classList.toggle('off', !on);
  st.querySelector('.lamp').classList.toggle('on', on);
  if (value !== undefined) st.querySelector('.v').textContent = value;
  window.dispatchEvent(new Event('resize'));   // rail wire redraws (an off parent's subtree loses its bus)
};
const mx = {};
// Dependents follow the matrix engine: with Matrix processing bypassed, its children (DSP pipelines,
// Crossfeed, Loudness) and DAC correction are not in effect, so their lamps go dark (their own settings are kept and
// relight on re-engage), and the page's Matrix engine section leaves (the page shows engaged stages only).
const mxOn = (v) => v.mxen === '1';
const mxSection = $('.sec[aria-label="Matrix profile"]');
const mxDrawer = mountDrawer($('#body'), stages.get('matrix'), MATRIX_DRAWER, { ...mx,
  onApply: (v) => {
    railSet('matrix', mxOn(v));
    if (mxApplied !== mxOn(v)) { mxApplied = mxOn(v); paintMeter(); }
    paintFill();   // the page's top: Matrix section (fill / folded / gone) or the spectrum
  } });
mxDrawer.setOpen(false);
// DSP pipelines: Overview + one tab per output. A matrix-family member: its edits stage with the rest
// of the profile. A tapped pin opens its output's tab.
const plCore = createPipelines(PIPELINES, { bypassed, plate, openCrossfeed: () => xfDrawer.setOpen(true), goTab: (id) => plDrawer.showTab(id) });
const plDrawer = mountDrawer($('#body'), stages.get('pipelines'), PIPELINES_DRAWER, { ...mx,
  blocks: Object.fromEntries([['pl-overview', plCore.overview], ...Array.from({ length: PIPELINES.outputs }, (_, o) => [`pl-out${o}`, plCore.output(o)])]),
  onApply: (v) => { plCore.sync(v); railSet('pipelines', mxOn(v), `${plCore.count()} active`); paintFill(); },
});
plDrawer.setOpen(false);
if (!FULL_FITS) $('#drawer-pipelines').classList.add('pl-short');   // short channel names keep their case (Sub, Lr)
const xfDrawer = mountDrawer($('#body'), stages.get('crossfeed'), CROSSFEED_DRAWER, { ...mx,
  blocks: { crossfeed: (host, ctx) => mountCrossfeed(host, CROSSFEED, ctx, bypassed) },
  onApply: (v) => {
    const m = v.xfmode;
    railSet('crossfeed', m !== 'off' && mxOn(v), { off: 'Off', bauer: 'Bauer', structural: 'Structural' }[m]);
    paintFill();
  },
});
xfDrawer.setOpen(false);
const loudDrawer = mountDrawer($('#body'), stages.get('loudness'), LOUDNESS_DRAWER, { ...mx,
  blocks: { loudness: (host, ctx) => mountLoudness(host, LOUDNESS, ctx, { bypassed, level, levelBus }) },
  onApply: (v) => {
    loudEngaged = v.ldon === '1';
    Object.assign(loud, { on: loudEngaged && mxOn(v), low: Number(v.ldrlow), high: Number(v.ldrhigh) });
    railSet('loudness', loud.on);
    levelBus.dispatchEvent(new CustomEvent('loudness'));
    loudValue(level);
    paintFill();
  },
});
loudDrawer.setOpen(false);
VOLUME_RANGE.openLoudness = () => loudDrawer.setOpen(true);   // Volume drawer's `Loudness ›` link
const dcDrawer = mountDrawer($('#body'), stages.get('correction'), CORRECTION_DRAWER, { ...mx,
  onApply: (v) => { railSet('correction', v.dcen === '1' && mxOn(v), v.dcen === '1' ? (v.dcdac || '[none]') : 'Bypassed'); paintFill(); },
});
dcDrawer.setOpen(false);
// The page's top section reads the whole family: paint it once everything is mounted.
const mxPick = mxSection.querySelector('.mstack > .inline');   // profile picker + Profile builder (moves to the header when folded)
fillReady = true;
paintFill();

// ── Speakers ─────────────────────────────────────────────────────────────────
// Speakers is not matrix processing: its own stage (before the Matrix engine), its own /speakers form and apply group.
const spkStage = stages.get('speakers');
const spkDrawer = mountDrawer($('#body'), spkStage, SPEAKERS_DRAWER, {
  blocks: { speakers: (host, ctx) => {
    spk = mountSpeakers(host, { ...SPEAKERS, sets: SETS }, ctx, (set) => {
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
xrefGo('volume-level', () => volDrawer.showTab('level'));                          // Fixed volume (same drawer)
xrefGo('volume-range', () => volDrawer.showTab('range'));                          // Min / Max (same drawer)
xrefGo('output-format', () => { outDrawer.setOpen(true); outDrawer.showTab('format'); });   // Shaping → DAC bits
xrefGo('dsdplay', () => dsdDrawer.openAt('sdm'));                                  // DSD Processing → SDM out → DSD playback

// ── Settings (gear): swaps the body; header, engine row, Setting Switcher stay. ─────────────────────────────────
$('#gear').addEventListener('click', closeSheets);   // the body swaps: no sheet stays over Settings
// The gear from the Snapshot builder goes straight to Settings (one body at a time).
let builder = null, profiles = null, stationB = null;
$('#gear').addEventListener('click', () => { if (builder?.isOn()) builder.setOn(false, false); if (profiles?.isOn()) profiles.setOn(false, false); if (stationB?.isOn()) stationB.setOn(false, false); });
const settings = mountSettings({ plate, gear: $('#gear'), chain: $('#body'), body: $('#sbody'), rail: $('#srail'), page: $('#spage') });

// ── Snapshot builder (header button): swaps the body; the active station's snapshots. ─────────────────────────────
builder = mountSnapshotBuilder(
  { btn: $('#sbbtn'), chain: $('#body'), body: $('#bbody'), rail: $('#brail'), page: $('#bpage'), settings },
  ...(location.hash.includes('many') ? [MANY_STATIONS, MANY] : location.hash.includes('long') ? [STATIONS, LONG] : [STATIONS, SNAPSHOTS]), () => ({ ...liveNow, ...conversion.state() }));

// ── Profile builder (Matrix engine section's button): swaps the body; the Matrix engine family on its own rail. ──────
// Edits a copy; Save writes the profile and restarts the engine: the knob reads Applying….
profiles = mountProfileBuilder(
  { btn: $('#pbbtn'), chain: $('#body'), body: $('#pbody'), rail: $('#prail'), page: $('#ppage'), plate, settings, snapshot: () => builder },
  STATIONS, PROFILES,
  { running: () => mprof.value, level: () => level, levelBus, fixed: () => fixedMode !== 'off',
    onSaved: (touched, rec, name, run) => {
      conn.applying();
      // Saved to the loaded station: it runs now (the restart Save causes, then the switch). The chain's Matrix engine family
      // takes its values as applied: drawers, rail lamps and values, the page section follow.
      if (run && rec) {
        const fam = familyOf('matrix');
        Object.assign(fam.base, rec.vals);
        for (const d of fam.members) d.discarded();
        for (const d of fam.members) { d.settle(); d.applied(); }
      }
      // The page lists the loaded station's profiles (mock: the builder's records are the source).
      const home = STATIONS.find((st) => st.active).name;
      const mine = touched.find(([st]) => st === home);
      if (mine) {
        const keep = mprof.value;
        mprof.replaceChildren(...mine[1].map((p) => new Option(p, p)));
        mprof.value = mine[1].includes(keep) ? keep : mine[1][0];
        if (run && rec) { mprof.value = name; mprof.dispatchEvent(new Event('change')); }
        if (rec && name === mprof.value) $('#mdesc').value = rec.desc;
      }
    } });
// The Snapshot builder's button from the Profile builder goes straight to it (one body at a time).
$('#sbbtn').addEventListener('click', () => { if (profiles.isOn()) profiles.setOn(false, false); });

// ── Station builder (header button): swaps the body; the setup wizard's station walk, one station at a time. ────────
// Edits a copy; Save writes the station (and the machine's hardware answers to every station). Saving the loaded station,
// or new hardware answers, restarts the engine: the knob reads Applying…. The header tree follows saves and deletes (mock:
// the Snapshot and Profile builders keep the stations they mounted with).
let treeStations = STATIONS.map((st) => ({ ...st }));
stationB = mountStationBuilder(
  { btn: $('#stbbtn'), chain: $('#body'), body: $('#stbody'), rail: $('#strail'), page: $('#stpage'),
    others: { settings, snapshot: () => builder, profiles: () => profiles } },
  STATIONS,
  { profilesOf: (st) => STATION_PROFILES(st),
    onRescan: () => conn.applying(),
    openProfiles: () => profiles.setOn(true),
    onSaved: ({ names, loaded, renamed, restart }) => {
      if (restart) conn.applying();
      const old = new Map(treeStations.map((st) => [st.name, st]));
      treeStations = names.map((n) => {
        const was = old.get(n) ?? (renamed?.to === n ? old.get(renamed.from) : null);
        return { ...(was ?? { snapshots: [] }), name: n, active: n === loaded };
      });
      tree.refresh(treeStations);
    } });
// Another body's button from the Station builder goes straight to it (one body at a time).
for (const b of ['#sbbtn', '#pbbtn']) $(b).addEventListener('click', () => { if (stationB.isOn()) stationB.setOn(false, false); });

// Everything that shows playback, for the scenario opened on (some of it mounted after the first report).
onPath(conversion.path(), conversion.running());

// Opens on the page, every drawer closed.
source.setOpen(false);
// Anything measured at load (rail wire, page copy fit, narrowing tags) re-measures once the web fonts land: every measurer
// listens for resize.
// Alerts onto their homes: mounted after every drawer and the Settings body, which it pins lines into.
alerts = mountAlerts({ plate, stages, srail: $('#srail') });
raise();
const remeasure = () => window.dispatchEvent(new Event('resize'));
document.fonts?.ready.then(remeasure);
document.fonts?.addEventListener('loadingdone', remeasure);
