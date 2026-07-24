// SPEAKERS — HQPlayer's per-channel speaker processing (readme §1.9): a level
// trim (dBFS) and a distance (cm) for each of the daemon's eight channel slots,
// plus the master switch.
//
// It does not join the pending-changes bar. The write is its own form POST that
// reloads the engine (~3 s) and is idle-gated server-side — the same lane, and
// the same cost, as a matrix profile Load — so edits live here and Apply sends
// them, with Revert dropping them. Folding it into the config staging buffer
// would put a 3 s engine reload behind a button that promises a batched apply.
//
// The speaker set is a CONTROL, not a reading of the engine's channel count:
// which channels you are configuring is the user's decision, and the daemon
// keeps all eight either way. Channels outside the set keep their stored values
// (the server re-reads the complete form and overlays only what is sent).
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";

import { html } from "../lib/dom.js";
import { NumberBox } from "./controls/index.js";
import { effective } from "../store/state.js";
import { notesVisible } from "../store/prefs.js";
import {
  speakers,
  speakersBusy,
  speakersError,
  speakersStale,
  loadSpeakers,
  applySpeakers,
} from "../store/speakers.js";
import { SpeakersDiagram } from "./SpeakersDiagram.js";

const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

const SETS = [
  { id: "2.0", label: "2.0 — stereo", channels: [0, 1] },
  { id: "2.1", label: "2.1 — stereo + sub", channels: [0, 1, 3] },
  { id: "3.0", label: "3.0 — stereo + center", channels: [0, 1, 2] },
  { id: "3.1", label: "3.1 — stereo + center + sub", channels: [0, 1, 2, 3] },
  { id: "5.1", label: "5.1 — surround", channels: [0, 1, 2, 3, 4, 5] },
  { id: "7.1", label: "7.1 — surround + sides", channels: [0, 1, 2, 3, 4, 5, 6, 7] },
];

// The daemon calls channel 3 "LFE"; everyone else calls the box on the floor a
// subwoofer. Display name only — the wire is untouched.
const displayName = (label) => (label === "LFE" ? "Sub" : label);

const SET_KEY = "hqptuner.speakerSet";

function loadSet() {
  try {
    const v = localStorage.getItem(SET_KEY);
    return SETS.some((s) => s.id === v) ? v : "2.0";
  } catch {
    return "2.0";
  }
}

// Card state with a public writer (chooseSet) — the signal itself stays private.

const speakerSet = signal(loadSet());
// Pending edits, {index: {level?, distance?}} — exactly the overlay the POST
// takes. Empty means "nothing to apply".
const edits = signal({});
const enabledEdit = signal(null); // null = follow the daemon's current switch
const note = signal("");

export function chooseSet(id) {
  speakerSet.value = id;
  try {
    localStorage.setItem(SET_KEY, id);
  } catch {
    /* storage disabled — the session still remembers */
  }
}

function editCh(index, field, value) {
  const row = { ...(edits.value[String(index)] || {}), [field]: String(value) };
  edits.value = { ...edits.value, [String(index)]: row };
}

function revert() {
  edits.value = {};
  enabledEdit.value = null;
  note.value = "";
}

const activeSet = () => new Set((SETS.find((s) => s.id === speakerSet.value) || SETS[0]).channels);

// --- rows --------------------------------------------------------------------

function ChannelRow({ ch, sdm }) {
  const pending = edits.value[String(ch.index)] || {};
  const level = pending.level ?? ch.level;
  const distance = pending.distance ?? ch.distance;
  return html`
    <div class="spkr-row">
      <span class="spkr-name">${displayName(ch.label)}</span>
      <label class="spkr-cell">
        <span class="spkr-unit">dBFS</span>
        <${NumberBox}
          value=${level}
          min=${ch.level_min}
          max=${ch.level_max}
          step=${ch.level_step ?? 0.1}
          disabled=${sdm}
          onChange=${(v) => editCh(ch.index, "level", v)}
        />
      </label>
      <label class="spkr-cell">
        <span class="spkr-unit">cm</span>
        <${NumberBox}
          value=${distance}
          min=${ch.distance_min}
          max=${ch.distance_max}
          step=${ch.distance_step ?? 1}
          onChange=${(v) => editCh(ch.index, "distance", v)}
        />
      </label>
    </div>
  `;
}

// --- card --------------------------------------------------------------------

// The card's own two settings. Not `Field`s: neither has a schema entry, because
// neither lives in the config lane — the switch belongs to the /speakers form and
// the set is client-side.
function TopRow({ on, busy }) {
  return html`
    <div class="pack split spkr-top">
      <div class="field">
        <label>Speaker processing</label>
        <input type="checkbox" checked=${on} disabled=${busy} onChange=${(e) => (enabledEdit.value = e.target.checked)} />
      </div>
      <div class="field">
        <label>Speaker set</label>
        <select value=${speakerSet.value} disabled=${busy} onChange=${(e) => chooseSet(e.target.value)}>
          ${SETS.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
        </select>
      </div>
    </div>
  `;
}

function Actions({ dirty, busy, apply }) {
  return html`
    <div class="spkr-actions">
      <button type="button" class="mtx-tool mtx-primary" disabled=${busy || !dirty} onClick=${apply}>
        ${busy ? "Applying…" : "Apply"}
      </button>
      <button type="button" class="mtx-tool" disabled=${busy || !dirty} onClick=${revert}>Revert</button>
      ${note.value && !dirty ? html`<span class="mtx-live-tag">${note.value}</span>` : null}
    </div>
  `;
}

function CardNote() {
  return notesVisible.value
    ? html`<div class="field-note">
        Level trims each channel's output; distance delays the nearer speakers so every channel arrives at the
        listening position together. Applying reloads the engine (~3 s) and needs it stopped — it is not a live change.
      </div>`
    : null;
}

// Pending edits overlaid on the daemon's channels — what the rows and the room
// plan both render, so an edited distance moves its speaker before Apply.
const merged = (data) => (data.channels || []).map((c) => ({ ...c, ...(edits.value[String(c.index)] || {}) }));

function Body({ data }) {
  const active = activeSet();
  // Direct SDM bypasses volume processing, so the level trims do nothing — but
  // the delays still apply, which is why only the level column grays and the
  // card stays live.
  const sdm = truthy(effective("direct_sdm"));
  const on = enabledEdit.value ?? !!data.enabled;
  const rows = merged(data);
  const dirty = Object.keys(edits.value).length > 0 || on !== !!data.enabled;
  const busy = speakersBusy.value;
  const apply = async () => {
    if (!(await applySpeakers(on, edits.value))) return;
    note.value = "applied — engine reloaded";
    revert();
  };
  return html`
    <div class="card-body">
      <${TopRow} on=${on} busy=${busy} />
      <div class="spkr-cols">
        <div class="spkr-rows">
          ${rows.filter((c) => active.has(c.index)).map((c) => html`<${ChannelRow} ch=${c} sdm=${sdm} />`)}
          ${
            sdm
              ? html`<div class="field-note spkr-sdm">
                  Direct SDM bypasses the volume control, so the level trims have no effect. Distances still apply.
                </div>`
              : null
          }
        </div>
        <span class="col-rule" aria-hidden="true"></span>
        <div class="spkr-right"><${SpeakersDiagram} channels=${rows} active=${active} /></div>
      </div>
      <${CardNote} />
      <${Actions} dirty=${dirty} busy=${busy} apply=${apply} />
      ${speakersError.value ? html`<div class="mtx-issues">${speakersError.value}</div>` : null}
    </div>
  `;
}

export function SpeakersCard() {
  const data = speakers.value;
  useEffect(() => {
    if (speakers.value === null) loadSpeakers();
  }, []);
  return html`
    <section class="card">
      <div class="card-head">
        Speakers ${speakersStale.value ? html`<span class="mtx-count">stale</span>` : null}
      </div>
      ${
        data
          ? html`<${Body} data=${data} />`
          : html`<div class="card-body">
              ${speakersError.value ? speakersError.value : "Loading speaker processing…"}
            </div>`
      }
    </section>
  `;
}
