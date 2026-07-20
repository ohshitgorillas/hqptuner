// Volume range — Min / Startup / Max on one shared dBFS axis, full width,
// directly under the master knob. The three values are interdependent (outline
// §Volume: startup is "an integer box from min-max volume"), so a shared axis
// states the relationship three separate boxes never did: the handles cannot
// cross, and the filled span between Min and Max IS the range the daemon will
// allow at runtime.
//
// Axis bounds come from the daemon's own /config form (volume_max -120..+12,
// volume_min -120..0) — note the asymmetry: only Max may exceed 0 dBFS, because
// only Max is documented as accepting positive gain (readme §1.2 volume_max
// "Allows also positive values (gain)"). The scale is linear across that range.
//
// Staging goes through the ordinary edit() path, so these behave exactly like
// the number boxes they replace: same dirty highlight, same Apply, same
// restart. Nothing here writes to the daemon directly.
import { signal } from "@preact/signals";
import { html } from "../store/dom.js";
import { effective, edit, isDirty } from "../store/state.js";
import { grayReason } from "../store/graying.js";
import { NumberBox } from "./controls/index.js";

const AXIS_MIN = -120;
const AXIS_MAX = 12;
const SPAN = AXIS_MAX - AXIS_MIN;

// dB -> percentage across the track.
const pct = (db) => ((Number(db) - AXIS_MIN) / SPAN) * 100;

// Labelled gridlines, most-important first. 0 is the limiter threshold (manual
// §2.5: the soft-knee limiter engages above 0 dB) and -3 the recommended ceiling
// when resampling (manual §2.15), so both draw a strong line. Order here IS the
// priority order used to drop labels that would collide.
const TICKS = [
  { db: 0, label: "0", strong: true },
  { db: -60, label: "-60" },
  { db: -120, label: "-120" },
  { db: 12, label: "+12" },
  { db: -20, label: "-20" },
  { db: -3, label: "-3", strong: true },
];

// Minimum gap between two labels, in track percent. Sized so the narrowest
// supported layout (~700px) keeps a few px of air between adjacent labels.
const MIN_LABEL_GAP = 3.5;

// Ticks always draw their line; a label is dropped when a higher-priority label
// already sits too close. At the default range -3 loses its label to 0 (2.3%
// apart) and keeps its line, which is the intended reading: 0 is the number,
// -3 is the mark just below it.
function withLabelFlags(ticks) {
  const kept = [];
  return ticks.map((t) => {
    const p = pct(t.db);
    const clear = kept.every((k) => Math.abs(k - p) >= MIN_LABEL_GAP);
    if (clear) kept.push(p);
    return { ...t, pos: p, showLabel: clear };
  });
}

const TICK_LAYOUT = withLabelFlags(TICKS);

const num = (v, dflt) => (v === "" || v == null || Number.isNaN(Number(v)) ? dflt : Number(v));

// Which handle is being dragged or hovered, for the value bubble. Null = none.
const active = signal(null);

// Clamp one handle against the axis, its own documented bound, and its
// neighbours. Ordering is enforced here rather than by refusing the input, so a
// handle dragged past its neighbour stops against it instead of jumping.
function clamp(which, v, { min, startup, max }) {
  const n = Math.round(num(v, 0));
  if (which === "min") return Math.max(AXIS_MIN, Math.min(n, 0, startup, max));
  if (which === "max") return Math.min(AXIS_MAX, Math.max(n, min, startup));
  return Math.max(min, Math.min(n, max)); // startup rides between the two
}

export function VolumeRangeBar() {
  const max = num(effective("volume_max"), 0);
  const min = num(effective("volume_min"), -60);
  const startup = num(effective("startup_volume"), min);
  const cur = { min, startup, max };

  // All three share a gray reason (same feature); take whichever fires —
  // DirectSDM grays the lot.
  const reason = grayReason("volume_max") || grayReason("volume_min") || grayReason("startup_volume");
  const dirty = isDirty("volume_max") || isDirty("volume_min") || isDirty("startup_volume");

  const set = (which, key) => (v) => edit(key, String(clamp(which, v, cur)));

  const handle = (which, key, db, label) => html`
    <input
      type="range"
      class="vr-handle vr-${which} ${isDirty(key) ? "dirty" : ""}"
      min=${AXIS_MIN}
      max=${AXIS_MAX}
      step="1"
      value=${db}
      disabled=${!!reason}
      aria-label=${label}
      onInput=${(e) => {
        active.value = { which, db: Number(e.target.value) };
        set(which, key)(e.target.value);
      }}
      onPointerDown=${() => (active.value = { which, db })}
      onPointerUp=${() => (active.value = null)}
      onMouseEnter=${() => (active.value = { which, db })}
      onMouseLeave=${() => (active.value = null)}
      onBlur=${() => (active.value = null)}
    />
  `;

  const bubbleFor = { min, startup, max };
  const bub = active.value;

  return html`
    <section class="card vr-card ${dirty ? "dirty" : ""}" title=${reason}>
      <div class="card-head">Range</div>
      <div class="card-body">
        <div class="vr-track ${reason ? "disabled" : ""}">
          <!-- the span the user will actually be able to reach at runtime -->
          <div class="vr-fill" style=${`left:${pct(min)}%;right:${100 - pct(max)}%`}></div>
          ${TICK_LAYOUT.map(
            (t) => html`
              <div class="vr-tick ${t.strong ? "strong" : ""}" style=${`left:${t.pos}%`}></div>
              ${t.showLabel
                ? html`<span class="vr-tick-label" style=${`left:${t.pos}%`}>${t.label}</span>`
                : null}
            `,
          )}
          ${handle("min", "volume_min", min, "Min volume")}
          ${handle("startup", "startup_volume", startup, "Startup volume")}
          ${handle("max", "volume_max", max, "Max volume")}
          ${bub
            ? html`<span class="vr-bubble vr-bubble-${bub.which}" style=${`left:${pct(bubbleFor[bub.which])}%`}>
                ${bubbleFor[bub.which]} dBFS
              </span>`
            : null}
        </div>
        <div class="vr-boxes">
          <label class="vr-box ${isDirty("volume_min") ? "dirty" : ""}">
            <span class="vr-key vr-key-min"></span>
            <span>Min</span>
            <${NumberBox} value=${min} min=${AXIS_MIN} max=${0} step="1" disabled=${!!reason} onChange=${set("min", "volume_min")} />
          </label>
          <label class="vr-box ${isDirty("startup_volume") ? "dirty" : ""}">
            <span class="vr-key vr-key-startup"></span>
            <span>Startup</span>
            <${NumberBox} value=${startup} min=${min} max=${max} step="1" disabled=${!!reason} onChange=${set("startup", "startup_volume")} />
          </label>
          <label class="vr-box ${isDirty("volume_max") ? "dirty" : ""}">
            <span class="vr-key vr-key-max"></span>
            <span>Max</span>
            <${NumberBox} value=${max} min=${AXIS_MIN} max=${AXIS_MAX} step="1" disabled=${!!reason} onChange=${set("max", "volume_max")} />
          </label>
        </div>
      </div>
    </section>
  `;
}
