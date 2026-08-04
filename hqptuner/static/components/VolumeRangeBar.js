// Volume range — Min / Startup / Max on one shared dBFS axis, full width,
// directly under the master knob. The three values are interdependent (architecture
// §4 — startup is "an integer box from min-max volume"), so a shared axis
// states the relationship three separate boxes never did: the handles cannot
// cross, and the filled span between Min and Max IS the range the daemon will
// allow at runtime.
//
// The axis bounds and the cannot-cross rule live in lib/volume.js: they are the
// daemon's contract rather than this bar's presentation, and keeping them out
// there is what makes them testable at all (nothing can fire an onInput under
// SSR). The scale is linear across that range.
//
// Staging goes through the ordinary edit() path, so these behave exactly like
// the number boxes they replace: same dirty highlight, same Apply, same
// restart. Nothing here writes to the daemon directly.
import { signal } from "@preact/signals";
import { html, wheelGuard } from "../lib/dom.js";
import { AXIS_MIN, AXIS_MAX, num, clampVolume } from "../lib/volume.js";
import { effective, isDirty } from "../store/resolve.js";
import { edit } from "../store/actions.js";
import { grayReason } from "../store/graying.js";
import { NumberBox } from "./controls/index.js";
import { Card } from "./tabs/common.js";

const SPAN = AXIS_MAX - AXIS_MIN;

// dB -> percentage across the track.
const pct = (db) => ((Number(db) - AXIS_MIN) / SPAN) * 100;

// Labelled gridlines, most-important first. 0 is the limiter threshold (manual
// §2.5: the soft-knee limiter engages above 0 dB) and -3 the recommended ceiling
// when resampling (manual §2.15), so both draw a strong line. Order here IS the
// priority order for dropping labels that would collide.
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

// Which handle is being dragged or hovered, for the value bubble. Null = none.
const active = signal(null);

// The three settings are one feature to the user, so the card speaks for the
// group: whichever key grays first supplies the reason (DirectSDM grays the
// lot), and any one staged edit lights the whole card. Declaration order below
// IS the priority order for the reason.
const KEYS = ["volume_max", "volume_min", "startup_volume"];
const groupReason = () => KEYS.reduce((found, k) => found || grayReason(k), "");
const groupDirty = () => KEYS.some(isDirty);

// Per-control highlight: only the setting actually edited carries it.
const dirtyClass = (key) => (isDirty(key) ? "dirty" : "");

export function VolumeRangeBar() {
  const max = num(effective("volume_max"), 0);
  const min = num(effective("volume_min"), -60);
  const startup = num(effective("startup_volume"), min);
  const cur = { min, startup, max };

  const reason = groupReason();
  const dirty = groupDirty();

  const set = (which, key) => (v) => edit(key, String(clampVolume(which, v, cur)));

  const handle = (which, key, db, label) => html`
    <input
      type="range"
      class="vr-handle vr-${which} ${dirtyClass(key)}"
      min=${AXIS_MIN}
      max=${AXIS_MAX}
      step="1"
      value=${db}
      disabled=${!!reason}
      aria-label=${label}
      onWheel=${wheelGuard}
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
    <${Card} title="Range" cardClass=${`vr-card ${dirty ? "dirty" : ""}`} hint=${reason}>
        <div class="vr-track ${reason ? "disabled" : ""}">
          <!-- the span the user will actually be able to reach at runtime -->
          <div class="vr-fill" style=${`left:${pct(min)}%;right:${100 - pct(max)}%`}></div>
          ${TICK_LAYOUT.map(
            (t) => html`
              <div class="vr-tick ${t.strong ? "strong" : ""}" style=${`left:${t.pos}%`}></div>
              ${t.showLabel ? html`<span class="vr-tick-label" style=${`left:${t.pos}%`}>${t.label}</span>` : null}
            `,
          )}
          ${handle("min", "volume_min", min, "Min volume")}
          ${handle("startup", "startup_volume", startup, "Startup volume")}
          ${handle("max", "volume_max", max, "Max volume")}
          ${
            bub
              ? html`<span class="vr-bubble vr-bubble-${bub.which}" style=${`left:${pct(bubbleFor[bub.which])}%`}>
                  ${bubbleFor[bub.which]} dBFS
                </span>`
              : null
          }
        </div>
        <div class="vr-boxes">
          <label class="vr-box ${dirtyClass("volume_min")}">
            <span class="vr-key"></span>
            <span>Min</span>
            <${NumberBox}
              value=${min}
              min=${AXIS_MIN}
              max=${0}
              step="1"
              disabled=${!!reason}
              onChange=${set("min", "volume_min")}
            />
          </label>
          <label class="vr-box ${dirtyClass("startup_volume")}">
            <span class="vr-key vr-key-startup"></span>
            <span>Startup</span>
            <${NumberBox}
              value=${startup}
              min=${min}
              max=${max}
              step="1"
              disabled=${!!reason}
              onChange=${set("startup", "startup_volume")}
            />
          </label>
          <label class="vr-box ${dirtyClass("volume_max")}">
            <span class="vr-key"></span>
            <span>Max</span>
            <${NumberBox}
              value=${max}
              min=${AXIS_MIN}
              max=${AXIS_MAX}
              step="1"
              disabled=${!!reason}
              onChange=${set("max", "volume_max")}
            />
          </label>
        </div>
    <//>
  `;
}
