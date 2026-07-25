// System tab: engine identity + backup/restore, metering, hardware
// acceleration, HQPTuner preferences, and the logging card.
import { computed, signal } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { health } from "../../store/state.js";
import { EngineHealth } from "../EngineHealth.js";
import { HardwareCard, BackupRestoreRow } from "../SystemHardware.js";
import { LogTail } from "../LogTail.js";
import { Checkbox } from "../controls/index.js";
import { accent, accentHex, applyAccent, applyAccentHex, ACCENTS, ACCENT_HEX } from "../../store/theme.js";
import {
  showDescriptions,
  keepOptionDescriptions,
  setShowDescriptions,
  setKeepOptionDescriptions,
} from "../../store/prefs.js";
import { Section, Card } from "./common.js";

const info = computed(() => (health.value && health.value.info) || {});
const license = computed(() => (health.value && health.value.license) || {});

const licenseLabel = (l) => {
  if (!l || l.valid == null) return "";
  // anything that isn't an explicit false/trial reads as licensed -> TRUE
  const v = String(l.valid).toLowerCase();
  const trial = v === "" || v === "0" || v === "false" || v === "trial";
  return trial ? "FALSE" : "TRUE";
};

const About = () => {
  const i = info.value;
  const rows = [
    ["Product", i.product],
    ["Version", i.engine],
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
  `;
};

// Inline-description visibility prefs. The master hides both the static feature
// notes and the per-selection option descriptions; the second checkbox — only
// live while the master is off — keeps the filter / DSD-source option
// descriptions visible even then.
const DescriptionPrefs = () => html`
  <div class="field">
    <label>Feature descriptions</label>
    <div class="control">
      <${Checkbox} value=${showDescriptions.value ? "1" : "0"} onChange=${(v) => setShowDescriptions(v === "1")} />
    </div>
    <div class="field-note">Show a manual note under each control</div>
  </div>
  <div class="field">
    <label>Option descriptions</label>
    <div class="control">
      <${Checkbox}
        value=${keepOptionDescriptions.value ? "1" : "0"}
        disabled=${showDescriptions.value}
        onChange=${(v) => setKeepOptionDescriptions(v === "1")}
      />
    </div>
    <div class="field-note">Keep filter and DSD source option descriptions when feature descriptions are hidden</div>
  </div>
`;

const ACCENT_LABELS = { blue: "Blue", green: "Phosphor green", amber: "Amber" };

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
        value=${accentHex.value || ACCENT_HEX[accent.value]}
        onChange=${(e) => applyAccentHex(e.target.value)}
        aria-label="Custom accent hex"
      />
    </div>
  </div>
`;

// A standing subsection of the HQPTuner card rather than a card of its own, so
// the tab's card rhythm is unchanged. Collapsed by default and not persisted —
// it is read-once prose, not a preference. Rides the shared inline-collapsible
// head the Crossfeed plots use, sitting full-width below the two-track prefs
// pack.
const aboutOpen = signal(false);

const AboutHqptuner = () => {
  const open = aboutOpen.value;
  return html`
    <div class="abt">
      <button type="button" class="collapsible-head" onClick=${() => (aboutOpen.value = !open)}>
        <span class="tri">${open ? "▾" : "▸"}</span> About HQPTuner
      </button>
      ${
        open
          ? html`<div class="abt-prose">
              <p>
                HQPTuner is a project by user oh shit, gorillas! to bring out the untapped UX potential of HQPlayer
                Embedded.
              </p>
              <p>
                Most credit goes to Jussi Laako/Signalyst. He builds it and makes it work, I'm just plugging into what
                he does and trying to make it pretty. Thanks, Jussi!
              </p>
              <p>
                HQPTuner is free and always will be. If it enhances your audio experience, then it's done its job and a
                simple "thank you" is all the payment I need. That said, if you really want your specific "thank you" to
                be financial, I won't stop you from${" "}
                <a href="https://ko-fi.com/ohshitgorillas" target="_blank" rel="noopener noreferrer"
                  >buying me a coffee</a
                >. Just don't say I strong-armed you into it ;)
              </p>
            </div>`
          : null
      }
    </div>
  `;
};

// Logging card — full width at the bottom of the tab. The two log-config options
// sit side by side at the top; the live tail view (checkbox-gated) sits below.
const LoggingCard = () =>
  html`<${Card} title="Logging">
    <div class="log-opts">
      <${Field} k="log_enabled" />
      <${Field} k="log_file" />
    </div>
    <${LogTail} />
  <//>`;

export const System = () =>
  html`<${Section}>
    <div class="card-grid">
      <${Card} title="About">
        <${About} />
        <${BackupRestoreRow} />
      <//>
      <${Card} title="Metering">
        <${Field} k="pre_before_meter" />
      <//>
    </div>
    <${Card} title="Engine health">
      <${EngineHealth} />
    <//>
    <${HardwareCard} />
    <${Card} title="HQPTuner">
      <!-- chain: the two description toggles stack in the LEFT track (they gate
           each other), leaving Accent color alone in the right. -->
      <div class="pack chain">
        <${DescriptionPrefs} />
        <${AccentPicker} />
      </div>
      <${AboutHqptuner} />
    <//>
    <${LoggingCard} />
  <//>`;
