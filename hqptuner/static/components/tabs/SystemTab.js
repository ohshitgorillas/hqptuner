// System tab: engine identity + backup/restore, HQPTuner preferences, timing and
// UPnP cards, hardware acceleration, the logging card, and the About HQPTuner card.
import { computed, signal } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { noteFor } from "../../store/prose.js";
import { health } from "../../store/signals.js";
import { EngineHealth } from "../EngineHealth.js";
import { HardwareCard, BackupRestoreRow } from "../SystemHardware.js";
import { LogTail } from "../LogTail.js";
import { Checkbox } from "../controls/index.js";
import {
  accent,
  accentHex,
  applyAccent,
  applyAccentHex,
  applyDyslexic,
  dyslexic,
  ACCENTS,
  ACCENT_HEX,
} from "../../store/theme.js";
import {
  showDescriptions,
  keepOptionDescriptions,
  setShowDescriptions,
  setKeepOptionDescriptions,
  apodLight,
  setApodLight,
} from "../../store/prefs.js";
import { Section, Card, collapseFrom } from "../common.js";

const info = computed(() => (health.value && health.value.info) || {});
// installed release ("6.0.2") off the daemon's /about page; "" when it could
// not be read — the Version row simply stays absent then.
const release = computed(() => (health.value && health.value.release) || "");
const license = computed(() => (health.value && health.value.license) || {});

/**
 * @param {{ valid?: string | number | boolean } | null | undefined} l the health payload's `license` block
 * @returns {string}
 */
const licenseLabel = (l) => {
  if (!l || l.valid == null) return "";
  // anything that isn't an explicit false/trial reads as licensed -> TRUE
  const v = String(l.valid).toLowerCase();
  const trial = v === "" || v === "0" || v === "false" || v === "trial";
  return trial ? "FALSE" : "TRUE";
};

// HQPTuner is developed and verified against the hqplayerd 6.0 series. Another
// series is never refused and nothing is disabled for it — the running engine is
// the authority for its own enumerations, so a different daemon largely just
// works — but the mismatch is worth saying once, directly under the Engine row
// it is about. Empty string when the daemon matches or has not reported one.
const VERIFIED_SERIES = "6.0";

const engineMismatch = computed(() => {
  const reported = info.value.engine || info.value.version || "";
  const parts = /^(\d+)\.(\d+)/.exec(reported);
  return parts && `${parts[1]}.${parts[2]}` !== VERIFIED_SERIES ? reported : "";
});

const About = () => {
  const i = info.value;
  const rows = [
    ["Product", i.product],
    ["Version", release.value],
    ["Engine", i.engine],
    ["Licensed", licenseLabel(license.value)],
    ["Platform", i.platform],
  ].filter((r) => r[1]);
  return html`
    <dl class="about">
      ${rows.map(
        ([k, v]) =>
          html`<div>
            <dt>${k}</dt>
            <dd>${v}</dd>
          </div>`,
      )}
    </dl>
    ${
      engineMismatch.value
        ? html`<p class="field-note" data-note="unverified-daemon">
          HQPTuner is verified against the hqplayerd ${VERIFIED_SERIES} series and this daemon reports
          ${engineMismatch.value}. Nothing is disabled for it — but if something misbehaves, that difference is worth
          putting in the report.
        </p>`
        : ""
    }
  `;
};

// Inline-description visibility prefs. The master hides both the static feature
// notes and the per-selection option descriptions; the second checkbox — only
// live while the master is off — keeps the filter / DSD-source option
// descriptions visible even then. While the master is on the second switch
// renders checked, since the master forces those descriptions visible; the
// stored pref is untouched.
const DescriptionPrefs = () => html`
  <div class="field" data-k="showDescriptions">
    <label>Setting descriptions</label>
    <div class="control">
      <${Checkbox}
        value=${showDescriptions.value ? "1" : "0"}
        onChange=${(/** @type {string | number} */ v) => setShowDescriptions(v === "1")}
      />
    </div>
    <div class="field-note">Show the description from the manual under each setting. Disabling this converts those descriptions to hover tips.</div>
  </div>
  <div class="field" data-k="keepOptionDescriptions">
    <label>Option descriptions</label>
    <div class="control">
      <${Checkbox}
        value=${showDescriptions.value || keepOptionDescriptions.value ? "1" : "0"}
        disabled=${showDescriptions.value}
        onChange=${(/** @type {string | number} */ v) => setKeepOptionDescriptions(v === "1")}
      />
    </div>
    <div class="field-note">Keep filter and DSD source option descriptions when setting descriptions are hidden</div>
  </div>
`;

// The header lamp's opt-in. It sits with the appearance preferences rather than
// in the Engine health card beside the strip it mirrors: what the switch governs
// is whether a thing appears in the chrome, and the chrome is what this card is
// for.
const ApodLightPref = () => html`
  <div class="field" data-k="apodLight">
    <label>Apodizing indicator</label>
    <div class="control">
      <${Checkbox}
        value=${apodLight.value ? "1" : "0"}
        onChange=${(/** @type {string | number} */ v) => setApodLight(v === "1")}
      />
    </div>
    <div class="field-note">flashes red on every apodizing event, always visible from header</div>
  </div>
`;

// The dyslexic font switch. Chrome, like the two above it: the store stamps
// `data-dyslexic` on the root and the CSS swaps `--font-ui` off it.
const DyslexicPref = () => html`
  <div class="field" data-k="dyslexic">
    <label>Dyslexic font</label>
    <div class="control">
      <${Checkbox}
        value=${dyslexic.value ? "1" : "0"}
        onChange=${(/** @type {string | number} */ v) => applyDyslexic(v === "1")}
      />
    </div>
    <div class="field-note">Use a dyslexic-friendly font (Atkinson Hyperlegible) for non-monospace text.</div>
  </div>
`;

/** @type {Record<string, string>} */
const ACCENT_LABELS = { blue: "Blue", green: "Phosphor green", amber: "Amber", violet: "Violet" };

// Swatches pick a preset; the hex box beside them holds that preset's value
// (auto-filled on pick) and accepts any custom #rrggbb, which overrides the
// preset until a swatch is picked again.
const AccentPicker = () => html`
  <div class="field">
    <label>Accent color</label>
    <div class="control accent-swatches">
      ${ACCENTS.map(
        (a) => html`
          <button
            type="button"
            class="swatch ${a} ${accent.value === a && !accentHex.value ? "active" : ""}"
            title=${ACCENT_LABELS[a]}
            aria-label=${ACCENT_LABELS[a]}
            aria-pressed=${accent.value === a && !accentHex.value}
            onClick=${() => applyAccent(a)}
          ></button>
        `,
      )}
      <input
        type="text"
        class="accent-hex"
        maxlength="7"
        value=${accentHex.value || ACCENT_HEX[/** @type {keyof typeof ACCENT_HEX} */ (accent.value)]}
        onChange=${(/** @type {{ target: HTMLInputElement }} */ e) => applyAccentHex(e.target.value)}
        aria-label="Custom accent hex"
      />
    </div>
  </div>
`;

// About HQPTuner — its own card at the foot of the tab, collapsed by default and
// not persisted: it is read-once prose, not a preference. `auto` is a constant
// closed, so the shared Collapsible's manual override is the only opener.
const aboutAuto = signal(false);
const aboutOverride = signal(null);

const appVersion = computed(() => (health.value && health.value.app_version) || "");

const AboutHqptuner = () => html`
  <${Card} id="about-hqptuner" title="About HQPTuner" collapse=${collapseFrom(aboutAuto, aboutOverride)}>
    <div class="abt-prose">
      <p>
        HQPTuner is a project by user oh shit, gorillas! to bring out the untapped UX potential of HQPlayer Embedded.
      </p>
      <p>
        Most credit goes to Jussi Laako/Signalyst. He builds it and makes it work, I'm just plugging into what he does
        and trying to make it pretty. Thanks, Jussi!
      </p>
      <p>
        HQPTuner is free and always will be. If it enhances your audio experience, then it's done its job and a simple
        "thank you" is all the payment I need. That said, if you really want your specific "thank you" to be financial,
        I won't stop you from${" "}
        <a href="https://ko-fi.com/ohshitgorillas" target="_blank" rel="noopener noreferrer">buying me a coffee</a>. Just
        don't say I strong-armed you into it ;)
      </p>
      <p class="t-micro">
        ${appVersion.value ? html`HQPTuner ${appVersion.value} · ` : ""}Released under the${" "}
        <a href="https://opensource.org/license/mit" target="_blank" rel="noopener noreferrer">MIT License</a>.
      </p>
    </div>
  <//>
`;

// Logging card — full width at the bottom of the tab. The two log-config options
// sit side by side at the top; the live tail view (checkbox-gated) sits below.
const LoggingCard = () =>
  html`<${Card} id="logging" title="Logging" subtitle=${noteFor("log_enabled")}>
    <div class="log-opts">
      <${Field} k="log_enabled" />
      <${Field} k="log_file" />
    </div>
    <${LogTail} />
  <//>`;

/** System tab: about and HQPTuner preference cards, engine health, timing, UPnP, hardware, and the logging card with the log tail. */
export const System = () =>
  html`<${Section}>
    <div class="card-grid">
      <${Card} id="about" title="About">
        <${About} />
        <${BackupRestoreRow} />
      <//>
      <${Card} id="hqptuner" title="HQPTuner">
        <!-- single column, no .pack: a half-width card's track is ~558px, and the
             12rem label + control of these rows overflows the ~267px half-track a
             two-up pack would give them (CLAUDE.md: the column is the cap). -->
        <${DescriptionPrefs} />
        <${ApodLightPref} />
        <${DyslexicPref} />
        <${AccentPicker} />
      <//>
    </div>
    <${Card} id="engine-health" title="Engine health">
      <${EngineHealth} />
    <//>
    <${Card} id="timing" title="Timing">
      <div class="pack">
        <${Field} k="idle_time" />
        <${Field} k="quick_pause" />
        <${Field} k="short_buffer" />
      </div>
    <//>
    <${Card} id="upnp" title="UPnP">
      <${Field} k="upnp_freewheel" />
    <//>
    <${HardwareCard} />
    <${LoggingCard} />
    <${AboutHqptuner} />
  <//>`;
